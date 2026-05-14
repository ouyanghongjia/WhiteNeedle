#import "WNCurlMonitor.h"
#import "WNRemoteServer.h"
#import "WNNetworkMonitor.h"
#import "fishhook.h"
#import <dlfcn.h>
#import <stdarg.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Curl]";

/*
 * Minimal libcurl type declarations to avoid requiring curl headers.
 * These must match the libcurl ABI exactly.
 */
typedef void CURL;
typedef void CURLM;
typedef int CURLcode;
typedef int CURLMcode;
typedef int CURLinfo;
typedef int CURLoption;
typedef struct curl_slist {
    char *data;
    struct curl_slist *next;
} curl_slist;
typedef size_t (*WNcurl_write_cb)(char *ptr, size_t size, size_t nmemb, void *userdata);

enum { CURLMSG_DONE_WN = 1 };
enum { CURLM_OK_WN = 0 };

typedef struct {
    int msg;          /* CURLMSG */
    CURL *easy_handle;
    union {
        void *whatever;
        CURLcode result;
    } data;
} WNCURLMsg;

/* CURLcode values we care about */
enum { CURLE_OK_WN = 0 };

/* CURLOPT values (from curl.h) */
enum {
    CURLOPT_WRITEDATA_WN        = 10001, /* CURLOPTTYPE_CBPOINT + 1 */
    CURLOPT_URL_WN             = 10002, /* CURLOPTTYPE_STRINGPOINT + 2 */
    CURLOPT_POSTFIELDS_WN      = 10015, /* CURLOPTTYPE_OBJECTPOINT + 15 */
    CURLOPT_COOKIE_WN          = 10022, /* CURLOPTTYPE_STRINGPOINT + 22 */
    CURLOPT_HTTPHEADER_WN      = 10023, /* CURLOPTTYPE_SLISTPOINT + 23 */
    CURLOPT_CUSTOMREQUEST_WN   = 10036, /* CURLOPTTYPE_STRINGPOINT + 36 */
    CURLOPT_POST_WN            = 47,    /* CURLOPTTYPE_LONG + 47 */
    CURLOPT_POSTFIELDSIZE_WN   = 60,    /* CURLOPTTYPE_LONG + 60 */
    CURLOPT_HEADERDATA_WN      = 10029, /* CURLOPTTYPE_CBPOINT + 29 */
    CURLOPT_WRITEFUNCTION_WN   = 20011, /* CURLOPTTYPE_FUNCTIONPOINT + 11 */
    CURLOPT_HEADERFUNCTION_WN  = 20079, /* CURLOPTTYPE_FUNCTIONPOINT + 79 */
    CURLOPT_COPYPOSTFIELDS_WN  = 10165, /* CURLOPTTYPE_OBJECTPOINT + 165 */
    CURLOPT_POSTFIELDSIZE_LARGE_WN = 30120, /* CURLOPTTYPE_OFF_T + 120 */
};

/* CURLINFO values (from curl.h) */
enum {
    CURLINFO_EFFECTIVE_URL_WN     = 0x100001, /* CURLINFO_STRING + 1 */
    CURLINFO_RESPONSE_CODE_WN     = 0x200002, /* CURLINFO_LONG + 2 */
    CURLINFO_TOTAL_TIME_WN        = 0x300003, /* CURLINFO_DOUBLE + 3 */
    CURLINFO_SIZE_DOWNLOAD_T_WN   = 0x600008, /* CURLINFO_OFF_T + 8 */
    CURLINFO_CONTENT_TYPE_WN      = 0x100012, /* CURLINFO_STRING + 18 */
    CURLINFO_HEADER_SIZE_WN       = 0x20000B, /* CURLINFO_LONG + 11 */
    CURLINFO_REQUEST_SIZE_WN      = 0x20000C, /* CURLINFO_LONG + 12 */
    CURLINFO_SSL_VERIFYRESULT_WN  = 0x20000D, /* CURLINFO_LONG + 13 */
    CURLINFO_REDIRECT_COUNT_WN    = 0x200014, /* CURLINFO_LONG + 20 */
    CURLINFO_COOKIELIST_WN        = 0x40001C, /* CURLINFO_SLIST + 28 */
    CURLINFO_PRIMARY_IP_WN        = 0x100020, /* CURLINFO_STRING + 32 */
    CURLINFO_PRIMARY_PORT_WN      = 0x200028, /* CURLINFO_LONG + 40 */
    CURLINFO_LOCAL_IP_WN          = 0x100029, /* CURLINFO_STRING + 41 */
    CURLINFO_LOCAL_PORT_WN        = 0x20002A, /* CURLINFO_LONG + 42 */
    CURLINFO_EFFECTIVE_METHOD_WN  = 0x10003A, /* CURLINFO_STRING + 58 */
};

#pragma mark - WNCurlMonitor

@interface WNCurlMonitor ()
@property (nonatomic, weak) WNRemoteServer *server;
@property (nonatomic, assign) NSUInteger nextId;
@property (nonatomic, assign, readwrite) BOOL hookSucceeded;
- (void)reportCurlRequest:(NSString *)url
                   method:(NSString *)method
                startTime:(NSTimeInterval)startTime
               statusCode:(long)statusCode
                totalTime:(NSTimeInterval)totalTime
              downloadSize:(int64_t)downloadSize
               requestSize:(long)requestSize
                headerSize:(long)headerSize
             redirectCount:(long)redirectCount
            sslVerifyResult:(long)sslVerifyResult
                 primaryIP:(nullable NSString *)primaryIP
                 primaryPort:(long)primaryPort
                   localIP:(nullable NSString *)localIP
                  localPort:(long)localPort
                    cookies:(NSArray<NSString *> *)cookies
             requestHeaders:(NSDictionary *)requestHeaders
            responseHeaders:(NSDictionary *)responseHeaders
                requestBody:(nullable NSString *)requestBody
               responseBody:(nullable NSString *)responseBody
              contentType:(nullable NSString *)contentType
                curlError:(int)curlError;
@end

@interface WNCurlHandleContext : NSObject
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) NSString *customMethod;
@property (nonatomic, copy) NSString *cookieHeader;
@property (nonatomic, assign) BOOL postEnabled;
@property (nonatomic, assign) const char *postFieldsPtr;
@property (nonatomic, assign) long long postFieldsSize;
@property (nonatomic, strong) NSData *requestBodyData;
@property (nonatomic, strong) NSMutableDictionary *requestHeaders;
@property (nonatomic, strong) NSMutableDictionary *responseHeaders;
@property (nonatomic, strong) NSMutableData *responseBodyData;
@property (nonatomic, assign) WNcurl_write_cb originalWriteFn;
@property (nonatomic, assign) void *originalWriteData;
@property (nonatomic, assign) WNcurl_write_cb originalHeaderFn;
@property (nonatomic, assign) void *originalHeaderData;
@property (nonatomic, assign) BOOL writeHookEnabled;
@property (nonatomic, assign) BOOL headerHookEnabled;
@property (nonatomic, assign) BOOL addedToMulti;
@property (nonatomic, assign) BOOL multiReported;
@property (nonatomic, assign) NSTimeInterval multiStartTime;
@end

@implementation WNCurlHandleContext
- (instancetype)init {
    self = [super init];
    if (self) {
        _postFieldsSize = -1;
        _requestHeaders = [NSMutableDictionary dictionary];
        _responseHeaders = [NSMutableDictionary dictionary];
        _responseBodyData = [NSMutableData data];
    }
    return self;
}
@end

#pragma mark - Hook storage

static CURLcode (*orig_curl_easy_perform)(CURL *handle) = NULL;
static CURLcode (*orig_kso_curl_easy_perform)(CURL *handle) = NULL;
static CURLcode (*orig_curl_easy_setopt)(CURL *handle, CURLoption option, ...) = NULL;
static CURLcode (*orig_kso_curl_easy_setopt)(CURL *handle, CURLoption option, ...) = NULL;
static void (*orig_curl_easy_cleanup)(CURL *handle) = NULL;
static void (*orig_kso_curl_easy_cleanup)(CURL *handle) = NULL;

static CURLMcode (*orig_curl_multi_add_handle)(CURLM *multi, CURL *easy) = NULL;
static CURLMcode (*orig_kso_curl_multi_add_handle)(CURLM *multi, CURL *easy) = NULL;
static WNCURLMsg *(*orig_curl_multi_info_read)(CURLM *multi, int *msgs_in_queue) = NULL;
static WNCURLMsg *(*orig_kso_curl_multi_info_read)(CURLM *multi, int *msgs_in_queue) = NULL;
static CURLMcode (*orig_curl_multi_remove_handle)(CURLM *multi, CURL *easy) = NULL;
static CURLMcode (*orig_kso_curl_multi_remove_handle)(CURLM *multi, CURL *easy) = NULL;

static __weak WNCurlMonitor *g_curlMonitor = nil;
static NSMutableDictionary<NSValue *, WNCurlHandleContext *> *g_handleContexts = nil;

static WNCurlHandleContext *WNContextForHandle(CURL *handle, BOOL createIfMissing) {
    if (!handle) return nil;
    @synchronized([WNCurlMonitor class]) {
        if (!g_handleContexts) {
            g_handleContexts = [NSMutableDictionary dictionary];
        }
        NSValue *key = [NSValue valueWithPointer:handle];
        WNCurlHandleContext *ctx = g_handleContexts[key];
        if (!ctx && createIfMissing) {
            ctx = [[WNCurlHandleContext alloc] init];
            g_handleContexts[key] = ctx;
        }
        return ctx;
    }
}

static void WNRemoveContextForHandle(CURL *handle) {
    if (!handle || !g_handleContexts) return;
    @synchronized([WNCurlMonitor class]) {
        NSValue *key = [NSValue valueWithPointer:handle];
        [g_handleContexts removeObjectForKey:key];
    }
}

static NSString *WNDataToString(NSData *data) {
    if (!data || data.length == 0) return nil;
    NSString *utf8 = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (utf8) return utf8;
    return [data base64EncodedStringWithOptions:0];
}

static void WNResetCaptureForContext(WNCurlHandleContext *ctx) {
    [ctx.responseHeaders removeAllObjects];
    [ctx.responseBodyData setLength:0];
}

static void WNCaptureRequestBodyIfNeeded(WNCurlHandleContext *ctx) {
    if (!ctx || !ctx.postFieldsPtr || ctx.requestBodyData.length > 0) return;
    long long sz = ctx.postFieldsSize;
    if (sz < 0) {
        sz = (long long)strlen(ctx.postFieldsPtr);
    }
    if (sz <= 0) return;
    ctx.requestBodyData = [NSData dataWithBytes:ctx.postFieldsPtr length:(NSUInteger)sz];
}

static NSDictionary *WNParseCurlHeaderList(curl_slist *list) {
    NSMutableDictionary *headers = [NSMutableDictionary dictionary];
    for (curl_slist *it = list; it != NULL; it = it->next) {
        if (!it->data) continue;
        NSString *line = [NSString stringWithUTF8String:it->data];
        if (line.length == 0) continue;
        NSRange r = [line rangeOfString:@":"];
        if (r.location == NSNotFound) continue;
        NSString *k = [[line substringToIndex:r.location] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        NSString *v = [[line substringFromIndex:r.location + 1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (k.length == 0) continue;
        headers[k] = v ?: @"";
    }
    return headers;
}

static size_t wn_capture_body_cb(char *ptr, size_t size, size_t nmemb, void *userdata) {
    WNCurlHandleContext *ctx = (__bridge WNCurlHandleContext *)userdata;
    size_t total = size * nmemb;
    if (ctx && total > 0 && ptr) {
        [ctx.responseBodyData appendBytes:ptr length:total];
    }
    if (ctx && ctx.originalWriteFn) {
        return ctx.originalWriteFn(ptr, size, nmemb, ctx.originalWriteData);
    }
    return total;
}

static size_t wn_capture_header_cb(char *ptr, size_t size, size_t nmemb, void *userdata) {
    WNCurlHandleContext *ctx = (__bridge WNCurlHandleContext *)userdata;
    size_t total = size * nmemb;
    if (ctx && total > 0 && ptr) {
        NSData *lineData = [NSData dataWithBytes:ptr length:total];
        NSString *line = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
        if (!line) {
            line = [[NSString alloc] initWithData:lineData encoding:NSISOLatin1StringEncoding];
        }
        if (line.length > 0) {
            NSString *trim = [line stringByTrimmingCharactersInSet:[NSCharacterSet newlineCharacterSet]];
            NSRange r = [trim rangeOfString:@":"];
            if (r.location != NSNotFound) {
                NSString *k = [[trim substringToIndex:r.location] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
                NSString *v = [[trim substringFromIndex:r.location + 1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
                if (k.length > 0) {
                    ctx.responseHeaders[k] = v ?: @"";
                }
            }
        }
    }
    if (ctx && ctx.originalHeaderFn) {
        return ctx.originalHeaderFn(ptr, size, nmemb, ctx.originalHeaderData);
    }
    return total;
}

#pragma mark - Shared getinfo resolver

typedef CURLcode (*WNGetInfoFn)(CURL *, CURLinfo, ...);

static WNGetInfoFn WNResolveGetInfoFn(void) {
    WNGetInfoFn fn = (WNGetInfoFn)dlsym(RTLD_DEFAULT, "curl_easy_getinfo");
    if (!fn) fn = (WNGetInfoFn)dlsym(RTLD_DEFAULT, "kso_curl_easy_getinfo");
    return fn;
}

static CURLcode (*WNResolveSetoptFn(void))(CURL *, CURLoption, ...) {
    if (orig_kso_curl_easy_setopt) return orig_kso_curl_easy_setopt;
    return orig_curl_easy_setopt;
}

static void WNInstallCaptureCallbacks(CURL *handle, WNCurlHandleContext *ctx) {
    CURLcode (*setoptFn)(CURL *, CURLoption, ...) = WNResolveSetoptFn();
    if (!setoptFn) return;

    if (!ctx.headerHookEnabled) {
        CURLcode rc = setoptFn(handle, (CURLoption)CURLOPT_HEADERFUNCTION_WN, (void *)wn_capture_header_cb);
        if (rc == CURLE_OK_WN) {
            setoptFn(handle, (CURLoption)CURLOPT_HEADERDATA_WN, (__bridge void *)ctx);
            ctx.headerHookEnabled = YES;
        }
    }
    if (!ctx.writeHookEnabled) {
        CURLcode rc = setoptFn(handle, (CURLoption)CURLOPT_WRITEFUNCTION_WN, (void *)wn_capture_body_cb);
        if (rc == CURLE_OK_WN) {
            setoptFn(handle, (CURLoption)CURLOPT_WRITEDATA_WN, (__bridge void *)ctx);
            ctx.writeHookEnabled = YES;
        }
    }
}

static void WNCollectAndReport(CURL *handle, CURLcode curlResult, NSTimeInterval startTime) {
    if (!g_curlMonitor) return;

    WNGetInfoFn getInfoFn = WNResolveGetInfoFn();
    WNCurlHandleContext *ctx = WNContextForHandle(handle, NO);
    if (!ctx) return;

    NSTimeInterval endTime = [[NSDate date] timeIntervalSince1970];

    NSString *url = ctx.url;
    if (!url && getInfoFn) {
        char *urlStr = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_EFFECTIVE_URL_WN, &urlStr) == CURLE_OK_WN && urlStr) {
            url = [NSString stringWithUTF8String:urlStr];
        }
    }
    if (!url) return;

    long statusCode = 0;
    double totalTime = 0;
    int64_t downloadSize = 0;
    long requestSize = 0, headerSize = 0, redirectCount = 0, sslVerifyResult = 0;
    long primaryPort = 0, localPort = 0;
    NSString *primaryIP = nil, *localIP = nil;
    NSString *effectiveMethod = ctx.customMethod ?: (ctx.postEnabled ? @"POST" : @"GET");
    NSMutableArray<NSString *> *cookies = [NSMutableArray array];
    if (ctx.cookieHeader.length > 0) [cookies addObject:ctx.cookieHeader];
    NSString *contentType = nil;

    if (getInfoFn) {
        getInfoFn(handle, (CURLinfo)CURLINFO_RESPONSE_CODE_WN, &statusCode);
        getInfoFn(handle, (CURLinfo)CURLINFO_TOTAL_TIME_WN, &totalTime);
        getInfoFn(handle, (CURLinfo)CURLINFO_SIZE_DOWNLOAD_T_WN, &downloadSize);
        getInfoFn(handle, (CURLinfo)CURLINFO_REQUEST_SIZE_WN, &requestSize);
        getInfoFn(handle, (CURLinfo)CURLINFO_HEADER_SIZE_WN, &headerSize);
        getInfoFn(handle, (CURLinfo)CURLINFO_REDIRECT_COUNT_WN, &redirectCount);
        getInfoFn(handle, (CURLinfo)CURLINFO_SSL_VERIFYRESULT_WN, &sslVerifyResult);
        getInfoFn(handle, (CURLinfo)CURLINFO_PRIMARY_PORT_WN, &primaryPort);
        getInfoFn(handle, (CURLinfo)CURLINFO_LOCAL_PORT_WN, &localPort);

        char *pip = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_PRIMARY_IP_WN, &pip) == CURLE_OK_WN && pip)
            primaryIP = [NSString stringWithUTF8String:pip];
        char *lip = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_LOCAL_IP_WN, &lip) == CURLE_OK_WN && lip)
            localIP = [NSString stringWithUTF8String:lip];
        char *method = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_EFFECTIVE_METHOD_WN, &method) == CURLE_OK_WN && method)
            effectiveMethod = [NSString stringWithUTF8String:method];
        char *ct = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_CONTENT_TYPE_WN, &ct) == CURLE_OK_WN && ct)
            contentType = [NSString stringWithUTF8String:ct];

        curl_slist *cookieList = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_COOKIELIST_WN, &cookieList) == CURLE_OK_WN && cookieList) {
            for (curl_slist *it = cookieList; it != NULL; it = it->next) {
                if (it->data) {
                    NSString *line = [NSString stringWithUTF8String:it->data];
                    if (line.length > 0) [cookies addObject:line];
                }
            }
            typedef void (*SListFreeFn)(curl_slist *);
            SListFreeFn freeFn = (SListFreeFn)dlsym(RTLD_DEFAULT, "curl_slist_free_all");
            if (!freeFn) freeFn = (SListFreeFn)dlsym(RTLD_DEFAULT, "kso_curl_slist_free_all");
            if (freeFn) freeFn(cookieList);
        }
    }

    NSDictionary *reqHeaders = [ctx.requestHeaders copy] ?: @{};
    NSDictionary *respHeaders = [ctx.responseHeaders copy] ?: @{};
    NSString *reqBodyStr = WNDataToString(ctx.requestBodyData);
    NSString *respBodyStr = WNDataToString(ctx.responseBodyData);

    [g_curlMonitor reportCurlRequest:url
                              method:effectiveMethod ?: @"GET"
                           startTime:startTime
                          statusCode:statusCode
                           totalTime:(totalTime > 0 ? totalTime : (endTime - startTime))
                        downloadSize:downloadSize
                          requestSize:requestSize
                           headerSize:headerSize
                        redirectCount:redirectCount
                       sslVerifyResult:sslVerifyResult
                            primaryIP:primaryIP
                          primaryPort:primaryPort
                              localIP:localIP
                             localPort:localPort
                               cookies:cookies
                        requestHeaders:reqHeaders
                       responseHeaders:respHeaders
                           requestBody:reqBodyStr
                          responseBody:respBodyStr
                         contentType:contentType
                           curlError:(curlResult != CURLE_OK_WN ? curlResult : 0)];
}

#pragma mark - Easy perform hook

static CURLcode wn_report_and_forward(CURL *handle, CURLcode (*origFn)(CURL *handle)) {
    if (!g_curlMonitor || !origFn) {
        return origFn ? origFn(handle) : -1;
    }

    WNCurlHandleContext *ctx = WNContextForHandle(handle, YES);
    WNResetCaptureForContext(ctx);
    WNCaptureRequestBodyIfNeeded(ctx);
    WNInstallCaptureCallbacks(handle, ctx);

    NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];
    CURLcode result = origFn(handle);

    WNCollectAndReport(handle, result, startTime);
    return result;
}

static CURLcode wn_curl_easy_perform(CURL *handle) {
    return wn_report_and_forward(handle, orig_curl_easy_perform);
}

static CURLcode wn_kso_curl_easy_perform(CURL *handle) {
    return wn_report_and_forward(handle, orig_kso_curl_easy_perform);
}

#pragma mark - Multi interface hooks

static CURLMcode wn_multi_add_handle_impl(CURLM *multi, CURL *easy,
                                           CURLMcode (*origFn)(CURLM *, CURL *)) {
    if (!origFn) return -1;

    WNCurlHandleContext *ctx = WNContextForHandle(easy, YES);
    WNResetCaptureForContext(ctx);
    WNCaptureRequestBodyIfNeeded(ctx);
    WNInstallCaptureCallbacks(easy, ctx);
    ctx.addedToMulti = YES;
    ctx.multiStartTime = [[NSDate date] timeIntervalSince1970];

    return origFn(multi, easy);
}

static CURLMcode wn_curl_multi_add_handle(CURLM *multi, CURL *easy) {
    return wn_multi_add_handle_impl(multi, easy, orig_curl_multi_add_handle);
}

static CURLMcode wn_kso_curl_multi_add_handle(CURLM *multi, CURL *easy) {
    return wn_multi_add_handle_impl(multi, easy, orig_kso_curl_multi_add_handle);
}

static WNCURLMsg *wn_multi_info_read_impl(CURLM *multi, int *msgs_in_queue,
                                           WNCURLMsg *(*origFn)(CURLM *, int *)) {
    if (!origFn) return NULL;

    WNCURLMsg *msg = origFn(multi, msgs_in_queue);
    if (msg && msg->msg == CURLMSG_DONE_WN && msg->easy_handle && g_curlMonitor) {
        CURL *easy = msg->easy_handle;
        WNCurlHandleContext *ctx = WNContextForHandle(easy, NO);
        if (ctx && !ctx.multiReported) {
            NSTimeInterval startTime = ctx.multiStartTime > 0 ? ctx.multiStartTime : [[NSDate date] timeIntervalSince1970];
            WNCollectAndReport(easy, msg->data.result, startTime);
            ctx.multiReported = YES;
        }
    }
    return msg;
}

static WNCURLMsg *wn_curl_multi_info_read(CURLM *multi, int *msgs_in_queue) {
    return wn_multi_info_read_impl(multi, msgs_in_queue, orig_curl_multi_info_read);
}

static WNCURLMsg *wn_kso_curl_multi_info_read(CURLM *multi, int *msgs_in_queue) {
    return wn_multi_info_read_impl(multi, msgs_in_queue, orig_kso_curl_multi_info_read);
}

static CURLMcode wn_multi_remove_handle_impl(CURLM *multi, CURL *easy,
                                              CURLMcode (*origFn)(CURLM *, CURL *)) {
    if (!origFn) return -1;

    WNCurlHandleContext *ctx = WNContextForHandle(easy, NO);
    if (ctx && ctx.addedToMulti && !ctx.multiReported && g_curlMonitor) {
        NSTimeInterval startTime = ctx.multiStartTime > 0 ? ctx.multiStartTime : [[NSDate date] timeIntervalSince1970];
        WNCollectAndReport(easy, CURLE_OK_WN, startTime);
    }
    if (ctx) {
        ctx.addedToMulti = NO;
        ctx.multiReported = NO;
    }
    return origFn(multi, easy);
}

static CURLMcode wn_curl_multi_remove_handle(CURLM *multi, CURL *easy) {
    return wn_multi_remove_handle_impl(multi, easy, orig_curl_multi_remove_handle);
}

static CURLMcode wn_kso_curl_multi_remove_handle(CURLM *multi, CURL *easy) {
    return wn_multi_remove_handle_impl(multi, easy, orig_kso_curl_multi_remove_handle);
}

static CURLcode wn_forward_setopt(CURL *handle, CURLoption option, va_list ap, CURLcode (*origFn)(CURL *, CURLoption, ...)) {
    if (!origFn) return -1;
    long typeBucket = option / 10000;
    WNCurlHandleContext *ctx = WNContextForHandle(handle, YES);

    if (typeBucket == 0) { // long
        long value = va_arg(ap, long);
        if (option == CURLOPT_POST_WN) {
            ctx.postEnabled = (value != 0);
        } else if (option == CURLOPT_POSTFIELDSIZE_WN) {
            ctx.postFieldsSize = (long long)value;
        }
        return origFn(handle, option, value);
    }
    if (typeBucket == 3) { // off_t / curl_off_t
        long long value = va_arg(ap, long long);
        if (option == CURLOPT_POSTFIELDSIZE_LARGE_WN) {
            ctx.postFieldsSize = value;
        }
        return origFn(handle, option, value);
    }

    void *ptr = va_arg(ap, void *);
    switch (option) {
        case CURLOPT_URL_WN:
            ctx.url = ptr ? [NSString stringWithUTF8String:(const char *)ptr] : nil;
            return origFn(handle, option, ptr);
        case CURLOPT_CUSTOMREQUEST_WN:
            ctx.customMethod = ptr ? [NSString stringWithUTF8String:(const char *)ptr] : nil;
            return origFn(handle, option, ptr);
        case CURLOPT_COOKIE_WN:
            ctx.cookieHeader = ptr ? [NSString stringWithUTF8String:(const char *)ptr] : nil;
            if (ctx.cookieHeader.length > 0) {
                ctx.requestHeaders[@"Cookie"] = ctx.cookieHeader;
            }
            return origFn(handle, option, ptr);
        case CURLOPT_HTTPHEADER_WN:
            [ctx.requestHeaders addEntriesFromDictionary:WNParseCurlHeaderList((curl_slist *)ptr)];
            return origFn(handle, option, ptr);
        case CURLOPT_POSTFIELDS_WN:
        case CURLOPT_COPYPOSTFIELDS_WN:
            ctx.postFieldsPtr = (const char *)ptr;
            ctx.postEnabled = YES;
            ctx.requestBodyData = nil;
            if (option == CURLOPT_COPYPOSTFIELDS_WN && ptr) {
                ctx.postFieldsSize = (long long)strlen((const char *)ptr);
                WNCaptureRequestBodyIfNeeded(ctx);
            }
            return origFn(handle, option, ptr);
        case CURLOPT_WRITEDATA_WN:
            ctx.originalWriteData = ptr;
            if (ctx.writeHookEnabled) {
                return origFn(handle, option, (__bridge void *)ctx);
            }
            return origFn(handle, option, ptr);
        case CURLOPT_WRITEFUNCTION_WN:
            ctx.originalWriteFn = (WNcurl_write_cb)ptr;
            ctx.writeHookEnabled = (ptr != NULL);
            if (ctx.writeHookEnabled) {
                CURLcode rc = origFn(handle, option, (void *)wn_capture_body_cb);
                if (rc == CURLE_OK_WN) {
                    origFn(handle, CURLOPT_WRITEDATA_WN, (__bridge void *)ctx);
                }
                return rc;
            }
            return origFn(handle, option, ptr);
        case CURLOPT_HEADERDATA_WN:
            ctx.originalHeaderData = ptr;
            if (ctx.headerHookEnabled) {
                return origFn(handle, option, (__bridge void *)ctx);
            }
            return origFn(handle, option, ptr);
        case CURLOPT_HEADERFUNCTION_WN:
            ctx.originalHeaderFn = (WNcurl_write_cb)ptr;
            ctx.headerHookEnabled = (ptr != NULL);
            if (ctx.headerHookEnabled) {
                CURLcode rc = origFn(handle, option, (void *)wn_capture_header_cb);
                if (rc == CURLE_OK_WN) {
                    origFn(handle, CURLOPT_HEADERDATA_WN, (__bridge void *)ctx);
                }
                return rc;
            }
            return origFn(handle, option, ptr);
        default:
            return origFn(handle, option, ptr);
    }
}

static CURLcode wn_curl_easy_setopt(CURL *handle, CURLoption option, ...) {
    va_list ap;
    va_start(ap, option);
    CURLcode rc = wn_forward_setopt(handle, option, ap, orig_curl_easy_setopt);
    va_end(ap);
    return rc;
}

static CURLcode wn_kso_curl_easy_setopt(CURL *handle, CURLoption option, ...) {
    va_list ap;
    va_start(ap, option);
    CURLcode rc = wn_forward_setopt(handle, option, ap, orig_kso_curl_easy_setopt);
    va_end(ap);
    return rc;
}

static void wn_curl_easy_cleanup(CURL *handle) {
    WNRemoveContextForHandle(handle);
    if (orig_curl_easy_cleanup) orig_curl_easy_cleanup(handle);
}

static void wn_kso_curl_easy_cleanup(CURL *handle) {
    WNRemoveContextForHandle(handle);
    if (orig_kso_curl_easy_cleanup) orig_kso_curl_easy_cleanup(handle);
}

@implementation WNCurlMonitor

+ (instancetype)shared {
    static WNCurlMonitor *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[WNCurlMonitor alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _nextId = 1;
        _hookSucceeded = NO;
    }
    return self;
}

- (void)startWithServer:(WNRemoteServer *)server {
    self.server = server;
    g_curlMonitor = self;

    [self installHooks];
}

- (void)installHooks {
    void *symCurl = dlsym(RTLD_DEFAULT, "curl_easy_perform");
    void *symKso = dlsym(RTLD_DEFAULT, "kso_curl_easy_perform");
    void *symSetopt = dlsym(RTLD_DEFAULT, "curl_easy_setopt");
    void *symKsoSetopt = dlsym(RTLD_DEFAULT, "kso_curl_easy_setopt");
    if (!symCurl && !symKso && !symSetopt && !symKsoSetopt) {
        NSLog(@"%@ curl_easy_perform/kso_curl_easy_perform symbols not found (likely statically linked). "
              @"knet request monitoring unavailable; host mapping via getaddrinfo still works.", kLogPrefix);
        self.hookSucceeded = NO;
        return;
    }

    struct rebinding rebindings[] = {
        {"curl_easy_perform",          (void *)wn_curl_easy_perform,          (void **)&orig_curl_easy_perform},
        {"kso_curl_easy_perform",      (void *)wn_kso_curl_easy_perform,      (void **)&orig_kso_curl_easy_perform},
        {"curl_easy_setopt",           (void *)wn_curl_easy_setopt,           (void **)&orig_curl_easy_setopt},
        {"kso_curl_easy_setopt",       (void *)wn_kso_curl_easy_setopt,       (void **)&orig_kso_curl_easy_setopt},
        {"curl_easy_cleanup",          (void *)wn_curl_easy_cleanup,          (void **)&orig_curl_easy_cleanup},
        {"kso_curl_easy_cleanup",      (void *)wn_kso_curl_easy_cleanup,      (void **)&orig_kso_curl_easy_cleanup},
        {"curl_multi_add_handle",      (void *)wn_curl_multi_add_handle,      (void **)&orig_curl_multi_add_handle},
        {"kso_curl_multi_add_handle",  (void *)wn_kso_curl_multi_add_handle,  (void **)&orig_kso_curl_multi_add_handle},
        {"curl_multi_info_read",       (void *)wn_curl_multi_info_read,       (void **)&orig_curl_multi_info_read},
        {"kso_curl_multi_info_read",   (void *)wn_kso_curl_multi_info_read,   (void **)&orig_kso_curl_multi_info_read},
        {"curl_multi_remove_handle",   (void *)wn_curl_multi_remove_handle,   (void **)&orig_curl_multi_remove_handle},
        {"kso_curl_multi_remove_handle",(void *)wn_kso_curl_multi_remove_handle,(void **)&orig_kso_curl_multi_remove_handle},
    };
    int rc = rebind_symbols(rebindings, sizeof(rebindings) / sizeof(rebindings[0]));

    BOOL hasEasy = (orig_curl_easy_perform || orig_kso_curl_easy_perform
                    || orig_curl_easy_setopt || orig_kso_curl_easy_setopt);
    BOOL hasMulti = (orig_curl_multi_add_handle || orig_kso_curl_multi_add_handle
                     || orig_curl_multi_info_read || orig_kso_curl_multi_info_read);

    if (rc != 0 || (!hasEasy && !hasMulti)) {
        NSLog(@"%@ fishhook rebind failed for curl symbols (rc=%d). "
              @"knet request monitoring unavailable; host mapping via getaddrinfo still works.", kLogPrefix, rc);
        self.hookSucceeded = NO;
        return;
    }

    self.hookSucceeded = YES;
    NSLog(@"%@ curl hooks installed — easy:%@ multi:%@ — knet requests will appear in network monitor",
          kLogPrefix,
          hasEasy ? @"YES" : @"NO",
          hasMulti ? @"YES" : @"NO");
}

- (void)reportCurlRequest:(NSString *)url
                   method:(NSString *)method
                startTime:(NSTimeInterval)startTime
                statusCode:(long)statusCode
                 totalTime:(NSTimeInterval)totalTime
              downloadSize:(int64_t)downloadSize
               requestSize:(long)requestSize
                headerSize:(long)headerSize
             redirectCount:(long)redirectCount
            sslVerifyResult:(long)sslVerifyResult
                 primaryIP:(nullable NSString *)primaryIP
               primaryPort:(long)primaryPort
                   localIP:(nullable NSString *)localIP
                 localPort:(long)localPort
                    cookies:(NSArray<NSString *> *)cookies
             requestHeaders:(NSDictionary *)requestHeaders
            responseHeaders:(NSDictionary *)responseHeaders
                requestBody:(nullable NSString *)requestBody
               responseBody:(nullable NSString *)responseBody
               contentType:(nullable NSString *)contentType
                 curlError:(int)curlError {

    NSString *reqId = [NSString stringWithFormat:@"curl_%lu", (unsigned long)self.nextId++];

    NSURL *parsed = [NSURL URLWithString:url];
    NSString *host = parsed.host ?: @"";
    NSString *httpMethod = (method.length > 0 ? method : @"GET");

    NSMutableDictionary *summary = [NSMutableDictionary dictionary];
    summary[@"id"]         = reqId;
    summary[@"method"]     = httpMethod;
    summary[@"url"]        = url;
    summary[@"host"]       = host;
    summary[@"status"]     = @(statusCode);
    summary[@"startTime"]  = @(startTime);
    summary[@"duration"]   = @(totalTime * 1000);
    summary[@"size"]       = @(MAX((int64_t)0, downloadSize));
    summary[@"mimeType"]   = contentType ?: @"";
    summary[@"error"]      = [NSNull null];
    summary[@"completed"]  = @YES;
    summary[@"source"]     = @"knet/curl";
    summary[@"requestSize"] = @(MAX(0L, requestSize));
    summary[@"headerSize"] = @(MAX(0L, headerSize));
    summary[@"redirectCount"] = @(MAX(0L, redirectCount));
    summary[@"sslVerifyResult"] = @(sslVerifyResult);
    summary[@"primaryIP"] = primaryIP ?: @"";
    summary[@"primaryPort"] = @(MAX(0L, primaryPort));
    summary[@"localIP"] = localIP ?: @"";
    summary[@"localPort"] = @(MAX(0L, localPort));
    NSMutableDictionary *mergedReqHeaders = [NSMutableDictionary dictionaryWithDictionary:requestHeaders ?: @{}];
    if (cookies.count > 0 && !mergedReqHeaders[@"Cookie"]) {
        mergedReqHeaders[@"Cookie"] = [cookies componentsJoinedByString:@"; "];
    }
    summary[@"requestHeaders"] = mergedReqHeaders;
    summary[@"responseHeaders"] = responseHeaders ?: @{};
    if (requestBody.length > 0) {
        summary[@"requestBody"] = requestBody;
    }
    if (responseBody.length > 0) {
        summary[@"responseBody"] = responseBody;
    }
    if (cookies.count > 0) {
        summary[@"cookies"] = cookies;
    }

    if (curlError != 0) {
        summary[@"error"] = [NSString stringWithFormat:@"CURLcode %d", curlError];
    }

    [[WNNetworkMonitor shared] injectCapturedSummary:summary];

    /* Broadcast both request and response in one shot since curl_easy_perform is synchronous */
    [self.server broadcastNotification:@"networkRequest" params:summary];
    [self.server broadcastNotification:@"networkResponse" params:summary];
}

@end
