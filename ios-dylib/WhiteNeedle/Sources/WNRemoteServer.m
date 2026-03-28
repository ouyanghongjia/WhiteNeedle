#import "WNRemoteServer.h"
#import "WNJSEngine.h"
#import "WNHookEngine.h"
#import "WNObjCBridge.h"
#import "WNNativeBridge.h"
#import <sys/socket.h>
#import <netinet/in.h>
#import <arpa/inet.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:TCP]";

#pragma mark - Client connection

@interface WNClientConnection : NSObject
@property (nonatomic, assign) CFSocketNativeHandle handle;
@property (nonatomic, strong) NSInputStream *input;
@property (nonatomic, strong) NSOutputStream *output;
@property (nonatomic, strong) NSMutableData *readBuffer;
@property (nonatomic, strong) NSMutableData *writeBuffer;
@property (nonatomic, weak) WNRemoteServer *server;
@end

@implementation WNClientConnection

- (instancetype)initWithHandle:(CFSocketNativeHandle)handle server:(WNRemoteServer *)server {
    self = [super init];
    if (self) {
        _handle = handle;
        _server = server;
        _readBuffer = [NSMutableData data];
        _writeBuffer = [NSMutableData data];

        CFReadStreamRef readStream;
        CFWriteStreamRef writeStream;
        CFStreamCreatePairWithSocket(NULL, handle, &readStream, &writeStream);

        _input = (__bridge_transfer NSInputStream *)readStream;
        _output = (__bridge_transfer NSOutputStream *)writeStream;

        [_input setProperty:@(YES) forKey:(NSString *)kCFStreamPropertyShouldCloseNativeSocket];
        [_output setProperty:@(YES) forKey:(NSString *)kCFStreamPropertyShouldCloseNativeSocket];
    }
    return self;
}

- (void)open {
    self.input.delegate = (id<NSStreamDelegate>)self.server;
    self.output.delegate = (id<NSStreamDelegate>)self.server;

    [self.input scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    [self.output scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];

    [self.input open];
    [self.output open];
}

- (void)close {
    [self.input close];
    [self.output close];
    [self.input removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    [self.output removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

- (void)sendData:(NSData *)data {
    if (self.output.hasSpaceAvailable) {
        [self.output write:data.bytes maxLength:data.length];
    } else {
        [self.writeBuffer appendData:data];
    }
}

@end

#pragma mark - WNRemoteServer

@interface WNRemoteServer () <NSStreamDelegate>
@property (nonatomic, strong) WNJSEngine *engine;
@property (nonatomic, assign) uint16_t port;
@property (nonatomic, assign) CFSocketRef listenSocket;
@property (nonatomic, strong) NSMutableArray<WNClientConnection *> *clients;
@property (nonatomic, assign) BOOL isListening;
- (void)acceptClient:(CFSocketNativeHandle)handle;
@end

static void WNSocketCallback(CFSocketRef socket, CFSocketCallBackType type,
                              CFDataRef address, const void *data, void *info) {
    if (type != kCFSocketAcceptCallBack) return;
    CFSocketNativeHandle handle = *(CFSocketNativeHandle *)data;
    WNRemoteServer *server = (__bridge WNRemoteServer *)info;
    [server acceptClient:handle];
}

@implementation WNRemoteServer

- (instancetype)initWithEngine:(WNJSEngine *)engine port:(uint16_t)port {
    self = [super init];
    if (self) {
        _engine = engine;
        _port = port;
        _clients = [NSMutableArray array];
        _isListening = NO;
    }
    return self;
}

- (void)start {
    if (self.isListening) return;

    CFSocketContext ctx = {0, (__bridge void *)self, NULL, NULL, NULL};
    self.listenSocket = CFSocketCreate(NULL, AF_INET, SOCK_STREAM, IPPROTO_TCP,
                                       kCFSocketAcceptCallBack, WNSocketCallback, &ctx);
    if (!self.listenSocket) {
        NSLog(@"%@ Failed to create socket", kLogPrefix);
        return;
    }

    int yes = 1;
    setsockopt(CFSocketGetNative(self.listenSocket), SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(self.port);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);

    CFDataRef addrData = CFDataCreate(NULL, (const UInt8 *)&addr, sizeof(addr));
    CFSocketError err = CFSocketSetAddress(self.listenSocket, addrData);
    CFRelease(addrData);

    if (err != kCFSocketSuccess) {
        NSLog(@"%@ Failed to bind to port %d", kLogPrefix, self.port);
        CFRelease(self.listenSocket);
        self.listenSocket = NULL;
        return;
    }

    CFRunLoopSourceRef source = CFSocketCreateRunLoopSource(NULL, self.listenSocket, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
    CFRelease(source);

    self.isListening = YES;
    NSLog(@"%@ Listening on port %d", kLogPrefix, self.port);

    // Wire up engine delegate for console forwarding
    self.engine.delegate = (id<WNJSEngineDelegate>)self;
}

- (void)stop {
    if (self.listenSocket) {
        CFSocketInvalidate(self.listenSocket);
        CFRelease(self.listenSocket);
        self.listenSocket = NULL;
    }

    for (WNClientConnection *client in self.clients) {
        [client close];
    }
    [self.clients removeAllObjects];

    self.isListening = NO;
    NSLog(@"%@ Server stopped", kLogPrefix);
}

- (void)acceptClient:(CFSocketNativeHandle)handle {
    WNClientConnection *client = [[WNClientConnection alloc] initWithHandle:handle server:self];
    [self.clients addObject:client];
    [client open];
    NSLog(@"%@ Client connected (%lu total)", kLogPrefix, (unsigned long)self.clients.count);
}

#pragma mark - NSStreamDelegate

- (void)stream:(NSStream *)aStream handleEvent:(NSStreamEvent)eventCode {
    WNClientConnection *client = [self clientForStream:aStream];
    if (!client) return;

    switch (eventCode) {
        case NSStreamEventHasBytesAvailable: {
            uint8_t buf[4096];
            NSInteger len = [client.input read:buf maxLength:sizeof(buf)];
            if (len > 0) {
                [client.readBuffer appendBytes:buf length:len];
                [self processMessages:client];
            }
            break;
        }
        case NSStreamEventHasSpaceAvailable: {
            if (client.writeBuffer.length > 0) {
                NSInteger written = [client.output write:client.writeBuffer.bytes maxLength:client.writeBuffer.length];
                if (written > 0) {
                    [client.writeBuffer replaceBytesInRange:NSMakeRange(0, written) withBytes:NULL length:0];
                }
            }
            break;
        }
        case NSStreamEventEndEncountered:
        case NSStreamEventErrorOccurred: {
            [client close];
            [self.clients removeObject:client];
            NSLog(@"%@ Client disconnected (%lu remaining)", kLogPrefix, (unsigned long)self.clients.count);
            break;
        }
        default:
            break;
    }
}

- (WNClientConnection *)clientForStream:(NSStream *)stream {
    for (WNClientConnection *client in self.clients) {
        if (client.input == stream || client.output == stream) return client;
    }
    return nil;
}

#pragma mark - JSON-RPC processing

- (void)processMessages:(WNClientConnection *)client {
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    NSRange range;

    while ((range = [client.readBuffer rangeOfData:newline options:0 range:NSMakeRange(0, client.readBuffer.length)]).location != NSNotFound) {
        NSData *lineData = [client.readBuffer subdataWithRange:NSMakeRange(0, range.location)];
        [client.readBuffer replaceBytesInRange:NSMakeRange(0, range.location + 1) withBytes:NULL length:0];

        NSError *error;
        NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:&error];
        if (!msg) continue;

        [self handleRequest:msg client:client];
    }
}

- (void)handleRequest:(NSDictionary *)request client:(WNClientConnection *)client {
    NSString *method = request[@"method"];
    NSDictionary *params = request[@"params"] ?: @{};
    NSNumber *requestId = request[@"id"];

    if (!method) return;

    dispatch_async(dispatch_get_main_queue(), ^{
        id result = [self dispatchMethod:method params:params];

        if (requestId) {
            NSDictionary *response;
            if ([result isKindOfClass:[NSError class]]) {
                NSError *err = (NSError *)result;
                response = @{
                    @"jsonrpc": @"2.0",
                    @"id": requestId,
                    @"error": @{
                        @"code": @(-32000),
                        @"message": err.localizedDescription ?: @"Unknown error"
                    }
                };
            } else {
                response = @{
                    @"jsonrpc": @"2.0",
                    @"id": requestId,
                    @"result": result ?: [NSNull null]
                };
            }

            NSData *data = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
            NSMutableData *line = [data mutableCopy];
            [line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
            [client sendData:line];
        }
    });
}

- (id)dispatchMethod:(NSString *)method params:(NSDictionary *)params {
    if ([method isEqualToString:@"loadScript"]) {
        NSString *code = params[@"code"];
        NSString *name = params[@"name"];
        if (!code || !name) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing code or name"}];
        BOOL ok = [self.engine loadScript:code name:name];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"unloadScript"]) {
        NSString *name = params[@"name"];
        if (name) [self.engine unloadScript:name];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"evaluate"]) {
        NSString *code = params[@"code"];
        if (!code) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing code"}];
        JSValue *result = [self.engine evaluateScript:code];
        return @{@"value": [result toString] ?: @"undefined"};
    }

    if ([method isEqualToString:@"listScripts"]) {
        return @{@"scripts": [self.engine loadedScriptNames]};
    }

    if ([method isEqualToString:@"listHooks"]) {
        NSMutableArray *all = [[WNHookEngine activeHooks] mutableCopy];
        [all addObjectsFromArray:[WNNativeBridge activeCHooks]];
        return @{@"hooks": all};
    }

    if ([method isEqualToString:@"listModules"]) {
        JSValue *result = [self.engine evaluateScript:@"Module.enumerateModules()"];
        return @{@"modules": [result toArray] ?: @[]};
    }

    if ([method isEqualToString:@"getClassNames"]) {
        NSString *filter = params[@"filter"];
        NSArray *names = [WNObjCBridge allClassNames:filter];
        return @{@"classes": names};
    }

    if ([method isEqualToString:@"getMethods"]) {
        NSString *className = params[@"className"];
        if (!className) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing className"}];
        Class cls = NSClassFromString(className);
        if (!cls) return @{@"methods": @[]};
        NSArray *methods = [WNObjCBridge methodsForClass:cls isInstance:YES];
        NSArray *classMethods = [WNObjCBridge methodsForClass:cls isInstance:NO];
        return @{@"instanceMethods": methods, @"classMethods": classMethods};
    }

    if ([method isEqualToString:@"rpcCall"]) {
        NSString *fnName = params[@"method"];
        NSArray *args = params[@"args"] ?: @[];
        if (!fnName) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing method"}];

        NSString *callCode = [NSString stringWithFormat:@"typeof rpc !== 'undefined' && rpc.exports && rpc.exports.%@? rpc.exports.%@(%@) : undefined",
                              fnName, fnName, [self jsArgsString:args]];
        JSValue *result = [self.engine evaluateScript:callCode];
        id obj = [result toObject];
        if (!obj || [result isUndefined]) return [NSNull null];
        if ([NSJSONSerialization isValidJSONObject:obj]) return obj;
        return [result toString] ?: [NSNull null];
    }

    return [NSError errorWithDomain:@"WN" code:-32601
                           userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Unknown method: %@", method]}];
}

- (NSString *)jsArgsString:(NSArray *)args {
    NSMutableArray *parts = [NSMutableArray array];
    for (id arg in args) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:@[arg] options:0 error:nil];
        if (data) {
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            // Remove wrapping [ ]
            json = [json substringWithRange:NSMakeRange(1, json.length - 2)];
            [parts addObject:json];
        }
    }
    return [parts componentsJoinedByString:@","];
}

#pragma mark - Broadcast notifications

- (void)broadcastNotification:(NSString *)method params:(NSDictionary *)params {
    NSDictionary *notification = @{
        @"jsonrpc": @"2.0",
        @"method": method,
        @"params": params ?: @{}
    };

    NSData *data = [NSJSONSerialization dataWithJSONObject:notification options:0 error:nil];
    if (!data) return;

    NSMutableData *line = [data mutableCopy];
    [line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];

    for (WNClientConnection *client in self.clients) {
        [client sendData:line];
    }
}

#pragma mark - WNJSEngineDelegate

- (void)jsEngine:(id)engine didReceiveConsoleMessage:(NSString *)message level:(NSString *)level {
    [self broadcastNotification:@"console" params:@{@"level": level, @"message": message}];
}

- (void)jsEngine:(id)engine didReceiveScriptError:(NSString *)error {
    [self broadcastNotification:@"scriptError" params:@{@"message": error}];
}

@end
