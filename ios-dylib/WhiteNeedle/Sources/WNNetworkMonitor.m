#import "WNNetworkMonitor.h"
#import "WNRemoteServer.h"
#import <objc/runtime.h>
#import <objc/message.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Network]";
static const NSUInteger kMaxCapturedRequests = 500;

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

#pragma mark - WNNetworkMonitor

@interface WNNetworkMonitor ()
@property (nonatomic, strong) NSMutableArray<WNCapturedRequest *> *requests;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, WNCapturedRequest *> *pendingByTaskId;
@property (nonatomic, weak) WNRemoteServer *server;
@property (nonatomic, assign) NSUInteger nextId;
@property (nonatomic, assign) BOOL hooked;
@end

static IMP g_originalDataTaskWithRequestCompletion = NULL;
static IMP g_originalDataTaskWithURLCompletion = NULL;

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
        _pendingByTaskId = [NSMutableDictionary new];
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
    NSLog(@"%@ Network monitor started", kLogPrefix);
}

- (void)stop {
    self.capturing = NO;
}

#pragma mark - Hook installation

- (void)installHooks {
    Class cls = [NSURLSession class];

    // Hook dataTaskWithRequest:completionHandler:
    SEL sel1 = @selector(dataTaskWithRequest:completionHandler:);
    Method m1 = class_getInstanceMethod(cls, sel1);
    if (m1) {
        g_originalDataTaskWithRequestCompletion = method_getImplementation(m1);
        IMP newIMP1 = imp_implementationWithBlock(^NSURLSessionDataTask *(NSURLSession *session, NSURLRequest *request, void (^completion)(NSData *, NSURLResponse *, NSError *)) {
            return [self interceptSession:session request:request originalIMP:g_originalDataTaskWithRequestCompletion sel:sel1 completion:completion];
        });
        method_setImplementation(m1, newIMP1);
        NSLog(@"%@ Hooked dataTaskWithRequest:completionHandler:", kLogPrefix);
    }

    // Hook dataTaskWithURL:completionHandler:
    SEL sel2 = @selector(dataTaskWithURL:completionHandler:);
    Method m2 = class_getInstanceMethod(cls, sel2);
    if (m2) {
        g_originalDataTaskWithURLCompletion = method_getImplementation(m2);
        IMP newIMP2 = imp_implementationWithBlock(^NSURLSessionDataTask *(NSURLSession *session, NSURL *url, void (^completion)(NSData *, NSURLResponse *, NSError *)) {
            NSURLRequest *request = [NSURLRequest requestWithURL:url];
            return [self interceptSession:session request:request originalIMP:g_originalDataTaskWithRequestCompletion sel:sel1 completion:completion];
        });
        method_setImplementation(m2, newIMP2);
        NSLog(@"%@ Hooked dataTaskWithURL:completionHandler:", kLogPrefix);
    }
}

- (NSURLSessionDataTask *)interceptSession:(NSURLSession *)session
                                   request:(NSURLRequest *)request
                               originalIMP:(IMP)origIMP
                                       sel:(SEL)sel
                                completion:(void (^)(NSData *, NSURLResponse *, NSError *))completion {

    if (!self.capturing) {
        typedef NSURLSessionDataTask *(*OrigFn)(id, SEL, NSURLRequest *, id);
        return ((OrigFn)origIMP)(session, sel, request, completion);
    }

    WNCapturedRequest *captured = [WNCapturedRequest new];
    captured.requestId = [NSString stringWithFormat:@"req_%lu", (unsigned long)self.nextId++];
    captured.method = request.HTTPMethod ?: @"GET";
    captured.url = request.URL.absoluteString ?: @"";
    captured.host = request.URL.host ?: @"";
    captured.requestHeaders = request.allHTTPHeaderFields ?: @{};
    captured.requestBody = request.HTTPBody;
    captured.startTime = [[NSDate date] timeIntervalSince1970];

    @synchronized(self.requests) {
        [self.requests addObject:captured];
        if (self.requests.count > kMaxCapturedRequests) {
            [self.requests removeObjectAtIndex:0];
        }
    }

    [self.server broadcastNotification:@"networkRequest" params:[captured summaryDict]];

    void (^wrappedCompletion)(NSData *, NSURLResponse *, NSError *) = ^(NSData *data, NSURLResponse *response, NSError *error) {
        captured.endTime = [[NSDate date] timeIntervalSince1970];
        captured.responseBody = data;
        captured.responseSize = data.length;
        captured.errorMessage = error.localizedDescription;

        if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            captured.statusCode = http.statusCode;
            captured.responseHeaders = http.allHeaderFields;
            captured.mimeType = http.MIMEType;
        }

        [self.server broadcastNotification:@"networkResponse" params:[captured summaryDict]];

        if (completion) completion(data, response, error);
    };

    typedef NSURLSessionDataTask *(*OrigFn)(id, SEL, NSURLRequest *, id);
    return ((OrigFn)origIMP)(session, sel, request, wrappedCompletion);
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

@end
