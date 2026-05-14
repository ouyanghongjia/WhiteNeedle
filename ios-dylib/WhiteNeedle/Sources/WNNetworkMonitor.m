#import "WNNetworkMonitor.h"
#import "WNRemoteServer.h"
#import <objc/runtime.h>
#import <objc/message.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Network]";
static const NSUInteger kMaxCapturedRequests = 500;
static NSString *const kWNMonitorHandledKey = @"com.whiteneedle.monitor.handled";

#pragma mark - Captured request model

@interface WNCapturedRequest : NSObject
@property (nonatomic, copy) NSString *requestId;
@property (nonatomic, copy) NSString *method;
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, strong) NSDictionary *requestHeaders;
@property (nonatomic, strong, nullable) NSData *requestBody;
@property (nonatomic, assign) NSInteger statusCode;
@property (nonatomic, strong, nullable) NSDictionary *responseHeaders;
@property (nonatomic, strong, nullable) NSData *responseBody;
@property (nonatomic, assign) NSTimeInterval startTime;
@property (nonatomic, assign) NSTimeInterval endTime;
@property (nonatomic, assign) int64_t responseSize;
@property (nonatomic, copy, nullable) NSString *errorMessage;
@property (nonatomic, copy, nullable) NSString *mimeType;
@property (nonatomic, copy) NSString *source;
@end

@implementation WNCapturedRequest
- (NSDictionary *)summaryDict {
    NSMutableDictionary *d = [NSMutableDictionary new];
    d[@"id"]         = self.requestId;
    d[@"method"]     = self.method ?: @"GET";
    d[@"url"]        = self.url ?: @"";
    d[@"host"]       = self.host ?: @"";
    d[@"status"]     = @(self.statusCode);
    d[@"startTime"]  = @(self.startTime);
    d[@"duration"]   = self.endTime > 0 ? @((self.endTime - self.startTime) * 1000) : [NSNull null];
    d[@"size"]       = @(self.responseSize);
    d[@"mimeType"]   = self.mimeType ?: @"";
    d[@"error"]      = self.errorMessage ?: [NSNull null];
    d[@"completed"]  = @(self.endTime > 0);
    d[@"source"]     = self.source ?: @"NSURLSession";
    return d;
}

- (NSDictionary *)detailDict {
    NSMutableDictionary *d = [[self summaryDict] mutableCopy];
    d[@"requestHeaders"] = self.requestHeaders ?: @{};
    d[@"responseHeaders"] = self.responseHeaders ?: @{};

    if (self.requestBody.length > 0 && self.requestBody.length < 1024 * 256) {
        NSString *bodyStr = [[NSString alloc] initWithData:self.requestBody encoding:NSUTF8StringEncoding];
        d[@"requestBody"] = bodyStr ?: [self.requestBody base64EncodedStringWithOptions:0];
    }

    if (self.responseBody.length > 0 && self.responseBody.length < 1024 * 256) {
        NSString *bodyStr = [[NSString alloc] initWithData:self.responseBody encoding:NSUTF8StringEncoding];
        d[@"responseBody"] = bodyStr ?: [self.responseBody base64EncodedStringWithOptions:0];
    }

    return d;
}
@end

#pragma mark - WNNetworkMonitor private interface (forward declaration for protocol)

@interface WNNetworkMonitor ()
@property (nonatomic, strong) NSMutableArray<WNCapturedRequest *> *requests;
@property (nonatomic, weak) WNRemoteServer *server;
@property (nonatomic, assign) NSUInteger nextId;
@property (nonatomic, assign) BOOL hooked;
@end

#pragma mark - WNNetworkMonitorProtocol

@class WNNetworkMonitorProtocol;

static NSURLSession *g_forwardSession = nil;
static NSMapTable<NSURLSessionTask *, WNNetworkMonitorProtocol *> *g_taskToProtocol = nil;
static NSUInteger g_monitorNextId = 0;

static NSUInteger WNNextMonitorId(void) {
    @synchronized([WNNetworkMonitor class]) {
        return ++g_monitorNextId;
    }
}

@interface WNNetworkMonitorProtocol : NSURLProtocol
@property (nonatomic, strong) NSURLSessionDataTask *dataTask;
@property (nonatomic, strong) WNCapturedRequest *captured;
@property (nonatomic, strong) NSMutableData *receivedData;
@end

@interface WNMonitorSessionDelegate : NSObject <NSURLSessionDataDelegate>
+ (instancetype)shared;
@end

@implementation WNMonitorSessionDelegate

+ (instancetype)shared {
    static WNMonitorSessionDelegate *inst;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{ inst = [[self alloc] init]; });
    return inst;
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    WNNetworkMonitorProtocol *proto;
    @synchronized(g_taskToProtocol) { proto = [g_taskToProtocol objectForKey:dataTask]; }
    [proto.client URLProtocol:proto didReceiveResponse:response
          cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
    WNNetworkMonitorProtocol *proto;
    @synchronized(g_taskToProtocol) { proto = [g_taskToProtocol objectForKey:dataTask]; }
    [proto.receivedData appendData:data];
    [proto.client URLProtocol:proto didLoadData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(nullable NSError *)error {
    WNNetworkMonitorProtocol *proto;
    @synchronized(g_taskToProtocol) {
        proto = [g_taskToProtocol objectForKey:task];
        [g_taskToProtocol removeObjectForKey:task];
    }
    if (!proto) return;

    WNCapturedRequest *cap = proto.captured;
    cap.endTime = [[NSDate date] timeIntervalSince1970];
    cap.responseBody = proto.receivedData;
    cap.responseSize = proto.receivedData.length;

    if (error) {
        cap.errorMessage = error.localizedDescription;
        [proto.client URLProtocol:proto didFailWithError:error];
    } else {
        [proto.client URLProtocolDidFinishLoading:proto];
    }

    NSURLResponse *resp = task.response;
    if ([resp isKindOfClass:[NSHTTPURLResponse class]]) {
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)resp;
        cap.statusCode = http.statusCode;
        cap.responseHeaders = http.allHeaderFields;
        cap.mimeType = http.MIMEType;
    }

    [[WNNetworkMonitor shared].server broadcastNotification:@"networkResponse" params:[cap summaryDict]];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
    WNNetworkMonitorProtocol *proto;
    @synchronized(g_taskToProtocol) { proto = [g_taskToProtocol objectForKey:task]; }
    NSMutableURLRequest *taggedRedirect = [request mutableCopy];
    [NSURLProtocol setProperty:@YES forKey:kWNMonitorHandledKey inRequest:taggedRedirect];
    [proto.client URLProtocol:proto wasRedirectedToRequest:taggedRedirect redirectResponse:response];
    completionHandler(taggedRedirect);
}

@end

@implementation WNNetworkMonitorProtocol

+ (void)ensureForwardSession {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        g_taskToProtocol = [NSMapTable strongToWeakObjectsMapTable];
        NSURLSessionConfiguration *config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
        g_forwardSession = [NSURLSession sessionWithConfiguration:config
                                                         delegate:[WNMonitorSessionDelegate shared]
                                                    delegateQueue:nil];
    });
}

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    if (![WNNetworkMonitor shared].capturing) return NO;
    if ([NSURLProtocol propertyForKey:kWNMonitorHandledKey inRequest:request]) return NO;
    NSString *scheme = request.URL.scheme.lowercaseString;
    return [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"];
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

- (void)startLoading {
    [[self class] ensureForwardSession];
    WNNetworkMonitor *monitor = [WNNetworkMonitor shared];

    WNCapturedRequest *cap = [WNCapturedRequest new];
    cap.requestId = [NSString stringWithFormat:@"req_%lu", (unsigned long)WNNextMonitorId()];
    cap.method = self.request.HTTPMethod ?: @"GET";
    cap.url = self.request.URL.absoluteString ?: @"";
    cap.host = self.request.URL.host ?: @"";
    cap.requestHeaders = self.request.allHTTPHeaderFields ?: @{};
    cap.requestBody = self.request.HTTPBody;
    cap.startTime = [[NSDate date] timeIntervalSince1970];
    cap.source = @"NSURLSession";
    self.captured = cap;
    self.receivedData = [NSMutableData data];

    @synchronized(monitor.requests) {
        [monitor.requests addObject:cap];
        if (monitor.requests.count > kMaxCapturedRequests) {
            [monitor.requests removeObjectAtIndex:0];
        }
    }

    [monitor.server broadcastNotification:@"networkRequest" params:[cap summaryDict]];

    NSMutableURLRequest *forwarded = [self.request mutableCopy];
    [NSURLProtocol setProperty:@YES forKey:kWNMonitorHandledKey inRequest:forwarded];

    NSURLSessionDataTask *task = [g_forwardSession dataTaskWithRequest:forwarded];
    self.dataTask = task;
    @synchronized(g_taskToProtocol) {
        [g_taskToProtocol setObject:self forKey:task];
    }
    [task resume];
}

- (void)stopLoading {
    NSURLSessionDataTask *task = self.dataTask;
    if (task) {
        @synchronized(g_taskToProtocol) {
            [g_taskToProtocol removeObjectForKey:task];
        }
        [task cancel];
    }
}

@end

#pragma mark - NSURLSessionConfiguration protocolClasses swizzle (chain-aware)

static NSArray<Class> *(*orig_monitorProtocolClassesGetter)(id, SEL) = NULL;

static NSArray<Class> *wn_monitorProtocolClassesGetter(id self, SEL _cmd) {
    NSArray<Class> *classes = orig_monitorProtocolClassesGetter
        ? orig_monitorProtocolClassesGetter(self, _cmd) : @[];
    if ([WNNetworkMonitor shared].capturing) {
        if (![classes containsObject:[WNNetworkMonitorProtocol class]]) {
            return [@[[WNNetworkMonitorProtocol class]] arrayByAddingObjectsFromArray:classes ?: @[]];
        }
    }
    return classes;
}

#pragma mark - WNNetworkMonitor

@implementation WNNetworkMonitor

+ (instancetype)shared {
    static WNNetworkMonitor *inst;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        inst = [[WNNetworkMonitor alloc] init];
    });
    return inst;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _requests = [NSMutableArray new];
        _capturing = YES;
        _nextId = 1;
    }
    return self;
}

- (void)startWithServer:(WNRemoteServer *)server {
    self.server = server;
    if (!self.hooked) {
        [self installHooks];
        self.hooked = YES;
    }
    NSLog(@"%@ Network monitor started (NSURLProtocol-based)", kLogPrefix);
}

- (void)stop {
    self.capturing = NO;
}

#pragma mark - Hook installation (NSURLProtocol)

- (void)installHooks {
    [NSURLProtocol registerClass:[WNNetworkMonitorProtocol class]];

    Method getter = class_getInstanceMethod([NSURLSessionConfiguration class],
                                            @selector(protocolClasses));
    if (getter) {
        orig_monitorProtocolClassesGetter = (void *)method_setImplementation(
            getter, (IMP)wn_monitorProtocolClassesGetter);
        NSLog(@"%@ NSURLSessionConfiguration.protocolClasses swizzled for monitor", kLogPrefix);
    }

    NSLog(@"%@ NSURLProtocol-based hooks installed (covers all NSURLSession tasks)", kLogPrefix);
}

#pragma mark - RPC interface

- (NSArray<NSDictionary *> *)capturedRequestList {
    NSMutableArray *result = [NSMutableArray new];
    @synchronized(self.requests) {
        for (WNCapturedRequest *r in self.requests) {
            [result addObject:[r summaryDict]];
        }
    }
    return result;
}

- (NSDictionary *)requestDetailForId:(NSString *)requestId {
    @synchronized(self.requests) {
        for (WNCapturedRequest *r in self.requests) {
            if ([r.requestId isEqualToString:requestId]) {
                return [r detailDict];
            }
        }
    }
    return nil;
}

- (void)clearAll {
    @synchronized(self.requests) {
        [self.requests removeAllObjects];
    }
}

- (void)injectCapturedSummary:(NSDictionary *)summary {
    WNCapturedRequest *r = [WNCapturedRequest new];
    r.requestId    = summary[@"id"] ?: @"";
    r.method       = summary[@"method"] ?: @"GET";
    r.url          = summary[@"url"] ?: @"";
    r.host         = summary[@"host"] ?: @"";
    r.statusCode   = [summary[@"status"] integerValue];
    r.startTime    = [summary[@"startTime"] doubleValue];
    r.responseSize = [summary[@"size"] longLongValue];
    r.mimeType     = summary[@"mimeType"];
    r.source       = summary[@"source"] ?: @"external";
    r.errorMessage = summary[@"error"];
    if ([summary[@"requestHeaders"] isKindOfClass:[NSDictionary class]]) {
        r.requestHeaders = summary[@"requestHeaders"];
    } else {
        r.requestHeaders = @{};
    }
    if ([summary[@"responseHeaders"] isKindOfClass:[NSDictionary class]]) {
        r.responseHeaders = summary[@"responseHeaders"];
    } else {
        r.responseHeaders = @{};
    }
    if ([summary[@"requestBody"] isKindOfClass:[NSString class]]) {
        r.requestBody = [summary[@"requestBody"] dataUsingEncoding:NSUTF8StringEncoding];
    }
    if ([summary[@"responseBody"] isKindOfClass:[NSString class]]) {
        r.responseBody = [summary[@"responseBody"] dataUsingEncoding:NSUTF8StringEncoding];
    }
    if ([summary[@"duration"] isKindOfClass:[NSNumber class]]) {
        if (r.startTime <= 0) {
            r.startTime = [[NSDate date] timeIntervalSince1970] - ([summary[@"duration"] doubleValue] / 1000.0);
        }
        r.endTime = r.startTime + [summary[@"duration"] doubleValue] / 1000.0;
    }
    @synchronized(self.requests) {
        [self.requests addObject:r];
        if (self.requests.count > kMaxCapturedRequests) {
            [self.requests removeObjectAtIndex:0];
        }
    }
}

@end
