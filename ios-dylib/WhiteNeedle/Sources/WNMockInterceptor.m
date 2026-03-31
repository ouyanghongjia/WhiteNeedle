#import "WNMockInterceptor.h"
#import <objc/runtime.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Mock]";

#pragma mark - WNMockRule

@implementation WNMockRule

- (instancetype)init {
    self = [super init];
    if (self) {
        _ruleId = [[NSUUID UUID] UUIDString];
        _statusCode = 200;
        _enabled = YES;
        _delay = 0;
        _mode = WNMockModePureMock;
    }
    return self;
}

- (BOOL)matchesRequest:(NSURLRequest *)request {
    if (!self.enabled) return NO;

    if (self.method && ![self.method isEqualToString:@"*"]) {
        if (![request.HTTPMethod.uppercaseString isEqualToString:self.method.uppercaseString]) {
            return NO;
        }
    }

    NSString *urlString = request.URL.absoluteString;
    if (!urlString || !self.urlPattern) return NO;

    if ([self.urlPattern hasPrefix:@"regex:"]) {
        NSString *pattern = [self.urlPattern substringFromIndex:6];
        NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:pattern
                                                                              options:0
                                                                                error:nil];
        if (!regex) return NO;
        NSRange range = [regex rangeOfFirstMatchInString:urlString
                                                 options:0
                                                   range:NSMakeRange(0, urlString.length)];
        return range.location != NSNotFound;
    }

    if ([self.urlPattern containsString:@"*"]) {
        NSString *escaped = [NSRegularExpression escapedPatternForString:self.urlPattern];
        NSString *regexPattern = [escaped stringByReplacingOccurrencesOfString:@"\\*"
                                                                   withString:@".*"];
        NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:regexPattern
                                                                              options:0
                                                                                error:nil];
        if (!regex) return NO;
        NSRange range = [regex rangeOfFirstMatchInString:urlString
                                                 options:0
                                                   range:NSMakeRange(0, urlString.length)];
        return range.location != NSNotFound;
    }

    return [urlString containsString:self.urlPattern];
}

- (NSDictionary *)toDictionary {
    NSMutableDictionary *d = [NSMutableDictionary dictionary];
    d[@"id"] = self.ruleId ?: @"";
    d[@"urlPattern"] = self.urlPattern ?: @"";
    d[@"method"] = self.method ?: @"*";
    d[@"mode"] = self.mode == WNMockModePureMock ? @"pureMock" : @"rewriteResponse";
    d[@"statusCode"] = @(self.statusCode);
    d[@"responseHeaders"] = self.responseHeaders ?: @{};
    d[@"responseBody"] = self.responseBody ?: @"";
    d[@"enabled"] = @(self.enabled);
    d[@"delay"] = @(self.delay);
    return d;
}

+ (WNMockRule *)ruleFromDictionary:(NSDictionary *)dict {
    WNMockRule *rule = [[WNMockRule alloc] init];
    if (dict[@"id"]) rule.ruleId = dict[@"id"];
    rule.urlPattern = dict[@"urlPattern"] ?: @"";
    rule.method = dict[@"method"];
    NSString *modeStr = dict[@"mode"];
    if ([modeStr isEqualToString:@"rewriteResponse"]) {
        rule.mode = WNMockModeRewriteResponse;
    } else {
        rule.mode = WNMockModePureMock;
    }
    if (dict[@"statusCode"]) rule.statusCode = [dict[@"statusCode"] integerValue];
    rule.responseHeaders = dict[@"responseHeaders"];
    rule.responseBody = dict[@"responseBody"];
    if (dict[@"enabled"]) rule.enabled = [dict[@"enabled"] boolValue];
    if (dict[@"delay"]) rule.delay = [dict[@"delay"] doubleValue];
    return rule;
}

@end

#pragma mark - WNMockURLProtocol

static NSString *const kWNMockHandledKey = @"com.whiteneedle.mock.handled";

@interface WNMockURLProtocol : NSURLProtocol <NSURLSessionDataDelegate>
@property (nonatomic, strong) NSURLSessionDataTask *dataTask;
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) WNMockRule *matchedRule;
@property (nonatomic, strong) NSMutableData *receivedData;
@end

@implementation WNMockURLProtocol

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    if ([NSURLProtocol propertyForKey:kWNMockHandledKey inRequest:request]) {
        return NO;
    }
    return [[WNMockInterceptor shared] matchingRuleForRequest:request] != nil;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

- (void)startLoading {
    self.matchedRule = [[WNMockInterceptor shared] matchingRuleForRequest:self.request];
    if (!self.matchedRule) {
        [self.client URLProtocol:self didFailWithError:
         [NSError errorWithDomain:@"WNMockInterceptor" code:-1 userInfo:nil]];
        return;
    }

    NSLog(@"%@ Intercepted %@ %@ (mode=%@)", kLogPrefix,
          self.request.HTTPMethod, self.request.URL.absoluteString,
          self.matchedRule.mode == WNMockModePureMock ? @"pureMock" : @"rewrite");

    if (self.matchedRule.mode == WNMockModePureMock) {
        [self deliverMockResponse];
    } else {
        [self sendRealRequestForRewrite];
    }
}

- (void)stopLoading {
    [self.dataTask cancel];
    [self.session invalidateAndCancel];
}

#pragma mark Pure Mock

- (void)deliverMockResponse {
    WNMockRule *rule = self.matchedRule;

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(rule.delay * NSEC_PER_SEC)),
                   dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        NSMutableDictionary *headers = [NSMutableDictionary dictionaryWithDictionary:rule.responseHeaders ?: @{}];
        if (!headers[@"Content-Type"]) {
            headers[@"Content-Type"] = @"application/json";
        }

        NSData *bodyData = [rule.responseBody dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
        headers[@"Content-Length"] = [@(bodyData.length) stringValue];

        NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:self.request.URL
                                                                  statusCode:rule.statusCode
                                                                 HTTPVersion:@"HTTP/1.1"
                                                                headerFields:headers];

        [self.client URLProtocol:self didReceiveResponse:response
              cacheStoragePolicy:NSURLCacheStorageNotAllowed];
        [self.client URLProtocol:self didLoadData:bodyData];
        [self.client URLProtocolDidFinishLoading:self];

        NSLog(@"%@ Pure mock delivered: %ld, %lu bytes", kLogPrefix,
              (long)rule.statusCode, (unsigned long)bodyData.length);
    });
}

#pragma mark Response Rewrite

- (void)sendRealRequestForRewrite {
    NSMutableURLRequest *mutable = [self.request mutableCopy];
    [NSURLProtocol setProperty:@YES forKey:kWNMockHandledKey inRequest:mutable];

    NSURLSessionConfiguration *config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    NSMutableArray *protocols = [config.protocolClasses mutableCopy] ?: [NSMutableArray array];
    [protocols removeObject:[WNMockURLProtocol class]];
    config.protocolClasses = protocols;

    self.session = [NSURLSession sessionWithConfiguration:config
                                                delegate:self
                                           delegateQueue:nil];
    self.receivedData = [NSMutableData data];
    self.dataTask = [self.session dataTaskWithRequest:mutable];
    [self.dataTask resume];
}

#pragma mark NSURLSessionDataDelegate (rewrite mode)

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
    [self.receivedData appendData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(nullable NSError *)error {
    if (error) {
        [self.client URLProtocol:self didFailWithError:error];
        return;
    }

    WNMockRule *rule = self.matchedRule;
    NSHTTPURLResponse *origResponse = (NSHTTPURLResponse *)task.response;

    NSInteger statusCode = rule.statusCode > 0 ? rule.statusCode : origResponse.statusCode;

    NSMutableDictionary *headers = [NSMutableDictionary dictionaryWithDictionary:
                                    origResponse.allHeaderFields ?: @{}];
    if (rule.responseHeaders) {
        [headers addEntriesFromDictionary:rule.responseHeaders];
    }

    NSData *bodyData;
    if (rule.responseBody && rule.responseBody.length > 0) {
        bodyData = [rule.responseBody dataUsingEncoding:NSUTF8StringEncoding];
    } else {
        bodyData = self.receivedData;
    }

    headers[@"Content-Length"] = [@(bodyData.length) stringValue];

    NSHTTPURLResponse *rewrittenResponse = [[NSHTTPURLResponse alloc] initWithURL:self.request.URL
                                                                       statusCode:statusCode
                                                                      HTTPVersion:@"HTTP/1.1"
                                                                     headerFields:headers];

    [self.client URLProtocol:self didReceiveResponse:rewrittenResponse
          cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocol:self didLoadData:bodyData];
    [self.client URLProtocolDidFinishLoading:self];

    NSLog(@"%@ Rewrite delivered: %ld → %ld, %lu bytes", kLogPrefix,
          (long)origResponse.statusCode, (long)statusCode, (unsigned long)bodyData.length);
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
    [self.client URLProtocol:self wasRedirectedToRequest:request redirectResponse:response];
    completionHandler(request);
}

@end

#pragma mark - NSURLSessionConfiguration protocolClasses swizzle

/*
 * Chain-aware swizzle: stores whatever IMP was installed before us
 * (could be the original Apple implementation or another swizzle like
 * WNHostMapping's). This lets multiple NSURLProtocol-based interceptors
 * coexist by chaining through each other's getter.
 */
static NSArray<Class> *(*orig_mockProtocolClassesGetter)(id, SEL) = NULL;

static NSArray<Class> *wn_mockProtocolClassesGetter(id self, SEL _cmd) {
    NSArray<Class> *classes = orig_mockProtocolClassesGetter(self, _cmd);
    if ([WNMockInterceptor shared].installed) {
        if (![classes containsObject:[WNMockURLProtocol class]]) {
            return [@[[WNMockURLProtocol class]] arrayByAddingObjectsFromArray:classes ?: @[]];
        }
    }
    return classes;
}

#pragma mark - WNMockInterceptor

@interface WNMockInterceptor ()
@property (nonatomic, strong) NSMutableArray<WNMockRule *> *rules;
@property (nonatomic, assign) BOOL sessionConfigSwizzled;
@property (nonatomic, readwrite) BOOL installed;
@end

@implementation WNMockInterceptor

+ (instancetype)shared {
    static WNMockInterceptor *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[WNMockInterceptor alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _rules = [NSMutableArray array];
        _installed = NO;
    }
    return self;
}

- (void)addRule:(WNMockRule *)rule {
    @synchronized (self.rules) {
        [self.rules addObject:rule];
    }
}

- (void)removeRule:(NSString *)ruleId {
    @synchronized (self.rules) {
        NSUInteger idx = [self.rules indexOfObjectPassingTest:^BOOL(WNMockRule *r, NSUInteger i, BOOL *stop) {
            return [r.ruleId isEqualToString:ruleId];
        }];
        if (idx != NSNotFound) {
            [self.rules removeObjectAtIndex:idx];
        }
    }
}

- (void)updateRule:(NSString *)ruleId withDict:(NSDictionary *)dict {
    @synchronized (self.rules) {
        NSUInteger idx = [self.rules indexOfObjectPassingTest:^BOOL(WNMockRule *r, NSUInteger i, BOOL *stop) {
            return [r.ruleId isEqualToString:ruleId];
        }];
        if (idx != NSNotFound) {
            WNMockRule *existing = self.rules[idx];
            if (dict[@"urlPattern"]) existing.urlPattern = dict[@"urlPattern"];
            if (dict[@"method"]) existing.method = dict[@"method"];
            if (dict[@"mode"]) {
                existing.mode = [dict[@"mode"] isEqualToString:@"rewriteResponse"]
                    ? WNMockModeRewriteResponse : WNMockModePureMock;
            }
            if (dict[@"statusCode"]) existing.statusCode = [dict[@"statusCode"] integerValue];
            if (dict[@"responseHeaders"]) existing.responseHeaders = dict[@"responseHeaders"];
            if (dict[@"responseBody"]) existing.responseBody = dict[@"responseBody"];
            if (dict[@"enabled"]) existing.enabled = [dict[@"enabled"] boolValue];
            if (dict[@"delay"]) existing.delay = [dict[@"delay"] doubleValue];
        }
    }
}

- (void)removeAllRules {
    @synchronized (self.rules) {
        [self.rules removeAllObjects];
    }
}

- (NSArray<NSDictionary *> *)allRules {
    @synchronized (self.rules) {
        NSMutableArray *result = [NSMutableArray arrayWithCapacity:self.rules.count];
        for (WNMockRule *rule in self.rules) {
            [result addObject:[rule toDictionary]];
        }
        return result;
    }
}

- (nullable WNMockRule *)matchingRuleForRequest:(NSURLRequest *)request {
    @synchronized (self.rules) {
        for (WNMockRule *rule in self.rules) {
            if ([rule matchesRequest:request]) {
                return rule;
            }
        }
    }
    return nil;
}

- (void)install {
    if (self.installed) return;

    [NSURLProtocol registerClass:[WNMockURLProtocol class]];

    if (!self.sessionConfigSwizzled) {
        Method getter = class_getInstanceMethod([NSURLSessionConfiguration class],
                                                @selector(protocolClasses));
        if (getter) {
            orig_mockProtocolClassesGetter = (void *)method_setImplementation(getter,
                                                    (IMP)wn_mockProtocolClassesGetter);
            self.sessionConfigSwizzled = YES;
            NSLog(@"%@ NSURLSessionConfiguration.protocolClasses swizzled for mock", kLogPrefix);
        }
    }

    self.installed = YES;
    NSLog(@"%@ Mock interceptor installed", kLogPrefix);
}

- (void)uninstall {
    if (!self.installed) return;

    [NSURLProtocol unregisterClass:[WNMockURLProtocol class]];
    self.installed = NO;
    NSLog(@"%@ Mock interceptor uninstalled", kLogPrefix);
}

@end
