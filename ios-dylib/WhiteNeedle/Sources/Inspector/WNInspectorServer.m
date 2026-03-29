#import "WNInspectorServer.h"
#import "WNInspectorBridge.h"
#import <sys/socket.h>
#import <netinet/in.h>
#import <arpa/inet.h>
#import <ifaddrs.h>
#import <unistd.h>
#import <fcntl.h>
#import <CommonCrypto/CommonDigest.h>
#import <os/lock.h>

static NSString *const kLogPrefix = @"[WNInspector:WS]";
static NSString *const kTargetId = @"whiteneedle-jsc-1";

#pragma mark - WebSocket frame helpers

typedef NS_ENUM(uint8_t, WNWSOpcode) {
    WNWSOpcodeText = 0x1,
    WNWSOpcodeClose = 0x8,
    WNWSOpcodePing = 0x9,
    WNWSOpcodePong = 0xA,
};

static NSData *WNWSEncodeTextFrame(NSString *text) {
    NSData *payload = [text dataUsingEncoding:NSUTF8StringEncoding];
    NSUInteger len = payload.length;

    NSMutableData *frame = [NSMutableData data];
    uint8_t header[2];
    header[0] = 0x81; /* FIN + Text opcode */

    if (len < 126) {
        header[1] = (uint8_t)len;
        [frame appendBytes:header length:2];
    } else if (len < 65536) {
        header[1] = 126;
        [frame appendBytes:header length:2];
        uint16_t extLen = htons((uint16_t)len);
        [frame appendBytes:&extLen length:2];
    } else {
        header[1] = 127;
        [frame appendBytes:header length:2];
        uint64_t extLen = 0;
        /* Write big-endian 64-bit length */
        for (int i = 7; i >= 0; i--) {
            uint8_t b = (uint8_t)((len >> (i * 8)) & 0xFF);
            [frame appendBytes:&b length:1];
        }
    }

    [frame appendData:payload];
    return frame;
}

static NSData *WNWSEncodeCloseFrame(uint16_t code) {
    uint8_t frame[4];
    frame[0] = 0x88; /* FIN + Close */
    frame[1] = 2;
    frame[2] = (uint8_t)(code >> 8);
    frame[3] = (uint8_t)(code & 0xFF);
    return [NSData dataWithBytes:frame length:4];
}

static NSData *WNWSEncodePongFrame(NSData *payload) {
    NSMutableData *frame = [NSMutableData data];
    uint8_t header[2];
    header[0] = 0x8A; /* FIN + Pong */
    header[1] = (uint8_t)payload.length;
    [frame appendBytes:header length:2];
    if (payload.length > 0) {
        [frame appendData:payload];
    }
    return frame;
}

#pragma mark - WebSocket Accept Key

static NSString *WNWSAcceptKey(NSString *clientKey) {
    NSString *concat = [clientKey stringByAppendingString:@"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"];
    NSData *data = [concat dataUsingEncoding:NSUTF8StringEncoding];

    uint8_t digest[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(data.bytes, (CC_LONG)data.length, digest);

    NSData *sha1 = [NSData dataWithBytes:digest length:CC_SHA1_DIGEST_LENGTH];
    return [sha1 base64EncodedStringWithOptions:0];
}

#pragma mark - Client connection

@interface WNWSClient : NSObject
@property (nonatomic, assign) CFSocketNativeHandle handle;
@property (nonatomic, strong) NSInputStream *input;
@property (nonatomic, strong) NSOutputStream *output;
@property (nonatomic, strong) NSMutableData *readBuffer;
@property (nonatomic, strong) NSMutableData *writeBuffer;
@property (nonatomic, assign) BOOL isWebSocket;
@property (nonatomic, assign) BOOL writePending;
@end

@implementation WNWSClient

- (instancetype)initWithHandle:(CFSocketNativeHandle)handle {
    self = [super init];
    if (self) {
        _handle = handle;
        _readBuffer = [NSMutableData data];
        _writeBuffer = [NSMutableData data];
        _isWebSocket = NO;
        _writePending = NO;

        CFReadStreamRef readStream;
        CFWriteStreamRef writeStream;
        CFStreamCreatePairWithSocket(NULL, handle, &readStream, &writeStream);

        _input = (__bridge_transfer NSInputStream *)readStream;
        _output = (__bridge_transfer NSOutputStream *)writeStream;
    }
    return self;
}

- (void)openWithDelegate:(id<NSStreamDelegate>)delegate {
    self.input.delegate = delegate;
    self.output.delegate = delegate;
    [self.input scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    [self.output scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    [self.input open];
    [self.output open];
}

- (void)close {
    if (self.input) {
        [self.input close];
        [self.input removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
        self.input = nil;
    }
    if (self.output) {
        [self.output close];
        [self.output removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
        self.output = nil;
    }
}

- (void)sendData:(NSData *)data {
    [self.writeBuffer appendData:data];
    [self flushWriteBuffer];
}

- (void)flushWriteBuffer {
    if (self.writeBuffer.length == 0) return;
    if (!self.output.hasSpaceAvailable) {
        self.writePending = YES;
        return;
    }
    NSInteger written = [self.output write:self.writeBuffer.bytes maxLength:self.writeBuffer.length];
    if (written > 0) {
        [self.writeBuffer replaceBytesInRange:NSMakeRange(0, written) withBytes:NULL length:0];
    }
    self.writePending = (self.writeBuffer.length > 0);
}

@end

#pragma mark - WNInspectorServer

@interface WNInspectorServer () <NSStreamDelegate, WNInspectorBridgeDelegate> {
    os_unfair_lock _wsWriteLock;
}
@property (nonatomic, strong) JSContext *context;
@property (nonatomic, assign) uint16_t port;
@property (nonatomic, assign) int listenFd;
@property (nonatomic, strong) dispatch_source_t acceptSource;
@property (nonatomic, strong) NSMutableArray<WNWSClient *> *httpClients;
@property (nonatomic, strong, nullable) WNWSClient *wsClient;
@property (nonatomic, strong, nullable) WNInspectorBridge *bridge;
@property (nonatomic, assign) BOOL isListening;
@property (nonatomic, assign) BOOL hasActiveSession;

@property (nonatomic, assign) int wsFd;
@property (nonatomic, strong, nullable) dispatch_source_t wsReadSource;
@property (nonatomic, strong, nullable) dispatch_queue_t wsIOQueue;
@property (nonatomic, strong, nullable) NSMutableData *wsReadBuf;

- (void)acceptConnection:(CFSocketNativeHandle)handle;
@end

@implementation WNInspectorServer

- (instancetype)initWithContext:(JSContext *)context port:(uint16_t)port {
    self = [super init];
    if (self) {
        _context = context;
        _port = port;
        _listenFd = -1;
        _wsFd = -1;
        _wsWriteLock = OS_UNFAIR_LOCK_INIT;
        _httpClients = [NSMutableArray array];
        _isListening = NO;
        _hasActiveSession = NO;
    }
    return self;
}

- (void)dealloc {
    [self stop];
}

- (void)start {
    if (self.isListening) return;

    if (![WNInspectorBridge isAvailable]) {
        NSLog(@"%@ Inspector bridge not available on this iOS version", kLogPrefix);
        NSLog(@"%@ Falling back to HTTP-only mode (no debugger)", kLogPrefix);
    }

    int fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (fd < 0) {
        NSLog(@"%@ Failed to create socket: %s", kLogPrefix, strerror(errno));
        return;
    }

    int yes = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_len = sizeof(addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons(self.port);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        NSLog(@"%@ Failed to bind to port %d: %s", kLogPrefix, self.port, strerror(errno));
        close(fd);
        return;
    }

    if (listen(fd, 8) < 0) {
        NSLog(@"%@ Failed to listen on port %d: %s", kLogPrefix, self.port, strerror(errno));
        close(fd);
        return;
    }

    fcntl(fd, F_SETFL, O_NONBLOCK);
    self.listenFd = fd;

    self.acceptSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ,
                                                (uintptr_t)fd, 0,
                                                dispatch_get_main_queue());
    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(self.acceptSource, ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;

        struct sockaddr_in clientAddr;
        socklen_t clientLen = sizeof(clientAddr);
        int clientFd = accept(fd, (struct sockaddr *)&clientAddr, &clientLen);
        if (clientFd >= 0) {
            NSLog(@"%@ Accepted connection from %s:%d (fd=%d)",
                  kLogPrefix,
                  inet_ntoa(clientAddr.sin_addr),
                  ntohs(clientAddr.sin_port),
                  clientFd);
            [strongSelf acceptConnection:clientFd];
        } else {
            NSLog(@"%@ accept() failed: %s", kLogPrefix, strerror(errno));
        }
    });
    dispatch_source_set_cancel_handler(self.acceptSource, ^{
        close(fd);
    });
    dispatch_resume(self.acceptSource);

    self.isListening = YES;
    NSLog(@"%@ Inspector server listening on port %d (fd=%d)", kLogPrefix, self.port, fd);
}

- (void)stop {
    if (self.acceptSource) {
        dispatch_source_cancel(self.acceptSource);
        self.acceptSource = nil;
        self.listenFd = -1;
    }

    [self.bridge disconnect];
    self.bridge = nil;

    if (self.wsReadSource) {
        dispatch_source_cancel(self.wsReadSource);
        self.wsReadSource = nil;
    }
    self.wsFd = -1;
    self.wsReadBuf = nil;
    self.wsIOQueue = nil;
    self.wsClient = nil;

    for (WNWSClient *client in self.httpClients) {
        [client close];
    }
    [self.httpClients removeAllObjects];

    self.isListening = NO;
    self.hasActiveSession = NO;
    NSLog(@"%@ Inspector server stopped", kLogPrefix);
}

- (nullable NSString *)webSocketDebuggerUrl {
    NSString *host = [self localIPAddress] ?: @"127.0.0.1";
    return [NSString stringWithFormat:@"ws://%@:%d/devtools/page/%@", host, self.port, kTargetId];
}

- (void)acceptConnection:(CFSocketNativeHandle)handle {
    NSLog(@"%@ acceptConnection: creating client for handle %d", kLogPrefix, handle);
    WNWSClient *client = [[WNWSClient alloc] initWithHandle:handle];
    [self.httpClients addObject:client];
    [client openWithDelegate:self];
    NSLog(@"%@ acceptConnection: streams opened, httpClients count=%lu", kLogPrefix, (unsigned long)self.httpClients.count);
}

#pragma mark - NSStreamDelegate

- (void)stream:(NSStream *)aStream handleEvent:(NSStreamEvent)eventCode {
    WNWSClient *client = [self clientForStream:aStream];
    if (!client) return;

    switch (eventCode) {
        case NSStreamEventHasBytesAvailable: {
            uint8_t buf[8192];
            NSInteger len = [client.input read:buf maxLength:sizeof(buf)];
            if (len > 0) {
                [client.readBuffer appendBytes:buf length:len];
                if (client.isWebSocket) {
                    [self processWebSocketData:client];
                } else {
                    [self processHTTPData:client];
                }
            }
            break;
        }
        case NSStreamEventHasSpaceAvailable: {
            if (client.writePending) {
                [client flushWriteBuffer];
            }
            break;
        }
        case NSStreamEventEndEncountered:
        case NSStreamEventErrorOccurred: {
            if (eventCode == NSStreamEventErrorOccurred) {
                NSLog(@"%@ stream error: %@", kLogPrefix, aStream.streamError);
            }
            [self removeClient:client];
            break;
        }
        default:
            break;
    }
}

- (WNWSClient *)clientForStream:(NSStream *)stream {
    if (self.wsClient && (self.wsClient.input == stream || self.wsClient.output == stream)) {
        return self.wsClient;
    }
    for (WNWSClient *c in self.httpClients) {
        if (c.input == stream || c.output == stream) return c;
    }
    return nil;
}

- (void)removeClient:(WNWSClient *)client {
    if (client == self.wsClient) {
        [self.bridge disconnect];
        self.bridge = nil;

        if (self.wsReadSource) {
            dispatch_source_cancel(self.wsReadSource);
            self.wsReadSource = nil;
        }
        self.wsFd = -1;
        self.wsReadBuf = nil;
        self.wsIOQueue = nil;

        self.wsClient = nil;
        self.hasActiveSession = NO;
        NSLog(@"%@ WebSocket client disconnected", kLogPrefix);
    } else {
        [client close];
        [self.httpClients removeObject:client];
    }
}

#pragma mark - HTTP processing

- (void)processHTTPData:(WNWSClient *)client {
    NSData *crlf2 = [@"\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding];
    NSRange range = [client.readBuffer rangeOfData:crlf2 options:0
                                             range:NSMakeRange(0, client.readBuffer.length)];
    if (range.location == NSNotFound) {
        NSLog(@"%@ processHTTPData: waiting for complete headers (buf=%lu bytes)",
              kLogPrefix, (unsigned long)client.readBuffer.length);
        return;
    }

    NSData *headerData = [client.readBuffer subdataWithRange:NSMakeRange(0, range.location)];
    NSString *headerStr = [[NSString alloc] initWithData:headerData encoding:NSUTF8StringEncoding];
    [client.readBuffer replaceBytesInRange:NSMakeRange(0, range.location + 4)
                                 withBytes:NULL length:0];

    NSArray *lines = [headerStr componentsSeparatedByString:@"\r\n"];
    if (lines.count == 0) return;

    NSString *requestLine = lines[0];
    NSArray *parts = [requestLine componentsSeparatedByString:@" "];
    if (parts.count < 2) return;

    NSString *method = parts[0];
    NSString *path = parts[1];
    NSLog(@"%@ HTTP request: %@ %@", kLogPrefix, method, path);

    /* Parse headers into dictionary */
    NSMutableDictionary *headers = [NSMutableDictionary dictionary];
    for (NSUInteger i = 1; i < lines.count; i++) {
        NSRange colonRange = [lines[i] rangeOfString:@": "];
        if (colonRange.location != NSNotFound) {
            NSString *key = [[lines[i] substringToIndex:colonRange.location] lowercaseString];
            NSString *value = [lines[i] substringFromIndex:colonRange.location + 2];
            headers[key] = value;
        }
    }

    /* Check for WebSocket upgrade */
    if ([method isEqualToString:@"GET"] &&
        [headers[@"upgrade"] caseInsensitiveCompare:@"websocket"] == NSOrderedSame &&
        headers[@"sec-websocket-key"]) {
        [self handleWebSocketUpgrade:client headers:headers path:path];
        return;
    }

    /* Handle HTTP endpoints */
    if ([method isEqualToString:@"GET"]) {
        if ([path isEqualToString:@"/json"] || [path isEqualToString:@"/json/list"]) {
            [self handleJSONList:client];
        } else if ([path isEqualToString:@"/json/version"]) {
            [self handleJSONVersion:client];
        } else {
            [self sendHTTPResponse:client status:404 body:@"Not Found"];
        }
    } else {
        [self sendHTTPResponse:client status:405 body:@"Method Not Allowed"];
    }
}

- (void)handleJSONList:(WNWSClient *)client {
    NSString *wsUrl = [self webSocketDebuggerUrl];
    NSString *host = [self localIPAddress] ?: @"127.0.0.1";
    NSString *devtoolsUrl = [NSString stringWithFormat:
        @"devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=%@:%d/devtools/page/%@",
        host, self.port, kTargetId];

    NSArray *targets = @[@{
        @"description": @"WhiteNeedle JSContext",
        @"devtoolsFrontendUrl": devtoolsUrl,
        @"id": kTargetId,
        @"title": @"WhiteNeedle",
        @"type": @"node",
        @"url": @"whiteneedle://jsc",
        @"webSocketDebuggerUrl": wsUrl ?: @"",
    }];

    NSData *json = [NSJSONSerialization dataWithJSONObject:targets
                                                   options:NSJSONWritingPrettyPrinted
                                                     error:nil];
    NSString *body = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    [self sendHTTPResponse:client status:200 contentType:@"application/json" body:body];
}

- (void)handleJSONVersion:(WNWSClient *)client {
    NSDictionary *version = @{
        @"Browser": @"WhiteNeedle/2.0.0",
        @"Protocol-Version": @"1.3",
        @"webSocketDebuggerUrl": [self webSocketDebuggerUrl] ?: @"",
    };

    NSData *json = [NSJSONSerialization dataWithJSONObject:version
                                                   options:NSJSONWritingPrettyPrinted
                                                     error:nil];
    NSString *body = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    [self sendHTTPResponse:client status:200 contentType:@"application/json" body:body];
}

- (void)handleWebSocketUpgrade:(WNWSClient *)client
                       headers:(NSDictionary *)headers
                          path:(NSString *)path {
    if (self.wsClient) {
        NSLog(@"%@ Rejecting WebSocket: another session is active", kLogPrefix);
        [self sendHTTPResponse:client status:409 body:@"Another inspector session is active"];
        return;
    }

    NSString *clientKey = headers[@"sec-websocket-key"];
    NSString *acceptKey = WNWSAcceptKey(clientKey);

    NSString *response = [NSString stringWithFormat:
        @"HTTP/1.1 101 Switching Protocols\r\n"
        @"Upgrade: websocket\r\n"
        @"Connection: Upgrade\r\n"
        @"Sec-WebSocket-Accept: %@\r\n"
        @"\r\n", acceptKey];

    client.isWebSocket = YES;
    [self.httpClients removeObject:client];
    self.wsClient = client;

    int fd = client.handle;

    /* Prevent NSStreams from closing the socket fd when we close them */
    CFReadStreamSetProperty((__bridge CFReadStreamRef)client.input,
                            kCFStreamPropertyShouldCloseNativeSocket,
                            kCFBooleanFalse);
    CFWriteStreamSetProperty((__bridge CFWriteStreamRef)client.output,
                             kCFStreamPropertyShouldCloseNativeSocket,
                             kCFBooleanFalse);

    /* Close NSStreams — the fd stays open for raw I/O */
    [client.input close];
    [client.input removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    client.input = nil;
    [client.output close];
    [client.output removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    client.output = nil;

    /* Send 101 handshake via raw write (streams are closed, use fd directly) */
    NSData *responseData = [response dataUsingEncoding:NSUTF8StringEncoding];
    const uint8_t *ptr = responseData.bytes;
    NSUInteger remaining = responseData.length;
    while (remaining > 0) {
        ssize_t n = write(fd, ptr, remaining);
        if (n > 0) { ptr += n; remaining -= (NSUInteger)n; }
        else if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) { usleep(1000); continue; }
        else break;
    }

    NSLog(@"%@ WebSocket connection established (switched to raw fd=%d)", kLogPrefix, fd);

    /* Set up raw I/O state */
    self.wsFd = fd;
    _wsWriteLock = OS_UNFAIR_LOCK_INIT;
    self.wsReadBuf = [NSMutableData data];

    /* Connect bridge BEFORE starting dispatch_source to avoid race */
    self.bridge = [[WNInspectorBridge alloc] initWithContext:self.context];
    self.bridge.delegate = self;

    if ([self.bridge connect]) {
        self.hasActiveSession = YES;
        NSLog(@"%@ Inspector bridge connected — ready for debugging", kLogPrefix);
    } else {
        NSLog(@"%@ Inspector bridge failed to connect", kLogPrefix);
    }

    /* Start background reading AFTER bridge is connected */
    [self startWSDispatchSourceForFd:fd];
}

- (void)sendHTTPResponse:(WNWSClient *)client status:(int)status body:(NSString *)body {
    [self sendHTTPResponse:client status:status contentType:@"text/plain" body:body];
}

- (void)sendHTTPResponse:(WNWSClient *)client
                  status:(int)status
             contentType:(NSString *)contentType
                    body:(NSString *)body {
    NSData *bodyData = [body dataUsingEncoding:NSUTF8StringEncoding];
    NSString *statusText = (status == 200) ? @"OK" :
                           (status == 404) ? @"Not Found" :
                           (status == 405) ? @"Method Not Allowed" :
                           (status == 409) ? @"Conflict" : @"Error";

    NSString *header = [NSString stringWithFormat:
        @"HTTP/1.1 %d %@\r\n"
        @"Content-Type: %@; charset=utf-8\r\n"
        @"Content-Length: %lu\r\n"
        @"Connection: close\r\n"
        @"Access-Control-Allow-Origin: *\r\n"
        @"\r\n",
        status, statusText, contentType, (unsigned long)bodyData.length];

    NSMutableData *response = [[header dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
    [response appendData:bodyData];

    NSLog(@"%@ sendHTTPResponse: status=%d bodyLen=%lu totalLen=%lu",
          kLogPrefix, status, (unsigned long)bodyData.length, (unsigned long)response.length);

    [client sendData:response];

    /* Close HTTP connections after response (not WebSocket) */
    if (!client.isWebSocket) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self removeClient:client];
        });
    }
}

#pragma mark - Background WebSocket I/O (dispatch_source)

- (void)startWSDispatchSourceForFd:(int)fd {
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);

    self.wsIOQueue = dispatch_queue_create("com.whiteneedle.ws.io", DISPATCH_QUEUE_SERIAL);
    self.wsReadSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ,
                                                (uintptr_t)fd, 0,
                                                self.wsIOQueue);

    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(self.wsReadSource, ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;

        uint8_t buf[8192];
        ssize_t n;
        while ((n = read(fd, buf, sizeof(buf))) > 0) {
            [strongSelf.wsReadBuf appendBytes:buf length:(NSUInteger)n];
        }

        if (n == 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf removeClient:weakSelf.wsClient];
            });
            return;
        }

        [strongSelf processWSFramesFromReadBuf];
    });

    dispatch_source_set_cancel_handler(self.wsReadSource, ^{
        close(fd);
    });

    dispatch_resume(self.wsReadSource);
}

- (void)processWSFramesFromReadBuf {
    while (self.wsReadBuf.length >= 2) {
        const uint8_t *bytes = (const uint8_t *)self.wsReadBuf.bytes;
        NSUInteger bufLen = self.wsReadBuf.length;

        uint8_t opcode = bytes[0] & 0x0F;
        BOOL masked = (bytes[1] & 0x80) != 0;
        uint64_t payloadLen = bytes[1] & 0x7F;

        NSUInteger headerLen = 2;
        if (payloadLen == 126) {
            if (bufLen < 4) return;
            payloadLen = ((uint64_t)bytes[2] << 8) | bytes[3];
            headerLen = 4;
        } else if (payloadLen == 127) {
            if (bufLen < 10) return;
            payloadLen = 0;
            for (int i = 0; i < 8; i++) {
                payloadLen = (payloadLen << 8) | bytes[2 + i];
            }
            headerLen = 10;
        }

        NSUInteger maskLen = masked ? 4 : 0;
        NSUInteger totalLen = headerLen + maskLen + (NSUInteger)payloadLen;
        if (bufLen < totalLen) return;

        const uint8_t *maskKey = masked ? (bytes + headerLen) : NULL;
        const uint8_t *payloadBytes = bytes + headerLen + maskLen;

        NSMutableData *payload = [NSMutableData dataWithLength:(NSUInteger)payloadLen];
        uint8_t *out = (uint8_t *)payload.mutableBytes;
        for (uint64_t i = 0; i < payloadLen; i++) {
            out[i] = masked ? (payloadBytes[i] ^ maskKey[i % 4]) : payloadBytes[i];
        }

        [self.wsReadBuf replaceBytesInRange:NSMakeRange(0, totalLen) withBytes:NULL length:0];

        switch (opcode) {
            case WNWSOpcodeText: {
                NSString *text = [[NSString alloc] initWithData:payload encoding:NSUTF8StringEncoding];
                if (text) {
                    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                        [self handleWebSocketMessage:text];
                    });
                }
                break;
            }
            case WNWSOpcodeClose: {
                [self rawWriteToWS:WNWSEncodeCloseFrame(1000)];
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self removeClient:self.wsClient];
                });
                return;
            }
            case WNWSOpcodePing: {
                [self rawWriteToWS:WNWSEncodePongFrame(payload)];
                break;
            }
            default:
                break;
        }
    }
}

- (void)rawWriteToWS:(NSData *)data {
    int fd = self.wsFd;
    if (fd < 0 || data.length == 0) return;

    const uint8_t *ptr = data.bytes;
    NSUInteger remaining = data.length;

    os_unfair_lock_lock(&_wsWriteLock);
    while (remaining > 0) {
        ssize_t n = write(fd, ptr, remaining);
        if (n > 0) {
            ptr += n;
            remaining -= (NSUInteger)n;
        } else if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                usleep(1000);
                continue;
            }
            NSLog(@"%@ raw write error: %s", kLogPrefix, strerror(errno));
            break;
        }
    }
    os_unfair_lock_unlock(&_wsWriteLock);
}

#pragma mark - WebSocket frame processing (NSStream path, HTTP phase only)

- (void)processWebSocketData:(WNWSClient *)client {
    while (client.readBuffer.length >= 2) {
        const uint8_t *bytes = (const uint8_t *)client.readBuffer.bytes;
        NSUInteger bufLen = client.readBuffer.length;

        uint8_t opcode = bytes[0] & 0x0F;
        BOOL masked = (bytes[1] & 0x80) != 0;
        uint64_t payloadLen = bytes[1] & 0x7F;

        NSUInteger headerLen = 2;
        if (payloadLen == 126) {
            if (bufLen < 4) return;
            payloadLen = ((uint64_t)bytes[2] << 8) | bytes[3];
            headerLen = 4;
        } else if (payloadLen == 127) {
            if (bufLen < 10) return;
            payloadLen = 0;
            for (int i = 0; i < 8; i++) {
                payloadLen = (payloadLen << 8) | bytes[2 + i];
            }
            headerLen = 10;
        }

        NSUInteger maskLen = masked ? 4 : 0;
        NSUInteger totalLen = headerLen + maskLen + (NSUInteger)payloadLen;
        if (bufLen < totalLen) return;

        /* Extract and unmask payload */
        const uint8_t *maskKey = masked ? (bytes + headerLen) : NULL;
        const uint8_t *payloadBytes = bytes + headerLen + maskLen;

        NSMutableData *payload = [NSMutableData dataWithLength:(NSUInteger)payloadLen];
        uint8_t *out = (uint8_t *)payload.mutableBytes;
        for (uint64_t i = 0; i < payloadLen; i++) {
            out[i] = masked ? (payloadBytes[i] ^ maskKey[i % 4]) : payloadBytes[i];
        }

        /* Remove processed frame from buffer */
        [client.readBuffer replaceBytesInRange:NSMakeRange(0, totalLen) withBytes:NULL length:0];

        /* Handle frame */
        switch (opcode) {
            case WNWSOpcodeText: {
                NSString *text = [[NSString alloc] initWithData:payload encoding:NSUTF8StringEncoding];
                if (text) {
                    [self handleWebSocketMessage:text];
                }
                break;
            }
            case WNWSOpcodeClose: {
                [client sendData:WNWSEncodeCloseFrame(1000)];
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)),
                               dispatch_get_main_queue(), ^{
                    [self removeClient:client];
                });
                return;
            }
            case WNWSOpcodePing: {
                [client sendData:WNWSEncodePongFrame(payload)];
                break;
            }
            default:
                break;
        }
    }
}

- (void)handleWebSocketMessage:(NSString *)message {
    WNInspectorBridge *bridge = self.bridge;
    if (!(bridge && bridge.isConnected)) return;
    [bridge dispatchMessage:message];
}

#pragma mark - WNInspectorBridgeDelegate

- (void)inspectorBridge:(id)bridge didReceiveMessage:(NSString *)message {
    if (self.wsFd < 0) return;
    [self rawWriteToWS:WNWSEncodeTextFrame(message)];
}

- (void)inspectorBridgeDidDisconnect:(id)bridge {
    NSLog(@"%@ Inspector bridge disconnected", kLogPrefix);
    self.hasActiveSession = NO;

    if (self.wsFd >= 0) {
        [self rawWriteToWS:WNWSEncodeCloseFrame(1001)];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self removeClient:self.wsClient];
        });
    }
}

#pragma mark - Utility

- (NSString *)localIPAddress {
    struct ifaddrs *interfaces = NULL;
    struct ifaddrs *temp = NULL;
    NSString *address = nil;

    if (getifaddrs(&interfaces) == 0) {
        temp = interfaces;
        while (temp != NULL) {
            if (temp->ifa_addr->sa_family == AF_INET) {
                NSString *name = [NSString stringWithUTF8String:temp->ifa_name];
                if ([name isEqualToString:@"en0"] || [name isEqualToString:@"en1"]) {
                    address = [NSString stringWithUTF8String:
                        inet_ntoa(((struct sockaddr_in *)temp->ifa_addr)->sin_addr)];
                    break;
                }
            }
            temp = temp->ifa_next;
        }
    }
    freeifaddrs(interfaces);
    return address;
}

@end
