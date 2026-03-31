#import "WNCurlMonitor.h"
#import "WNRemoteServer.h"
#import "fishhook.h"
#import <dlfcn.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Curl]";

/*
 * Minimal libcurl type declarations to avoid requiring curl headers.
 * These must match the libcurl ABI exactly.
 */
typedef void CURL;
typedef int CURLcode;
typedef int CURLinfo;

/* CURLcode values we care about */
enum { CURLE_OK_WN = 0 };

/* CURLOPT values (from curl.h) */
enum {
    CURLOPT_URL_WN             = 10002, /* CURLOPTTYPE_STRINGPOINT + 2 */
    CURLOPT_HTTPHEADER_WN      = 10023, /* CURLOPTTYPE_SLISTPOINT + 23 */
};

/* CURLINFO values (from curl.h) */
enum {
    CURLINFO_EFFECTIVE_URL_WN     = 0x100001, /* CURLINFO_STRING + 1 */
    CURLINFO_RESPONSE_CODE_WN     = 0x200002, /* CURLINFO_LONG + 2 */
    CURLINFO_TOTAL_TIME_WN        = 0x300004, /* CURLINFO_DOUBLE + 4 (v7: CURLINFO_TOTAL_TIME) */
    CURLINFO_SIZE_DOWNLOAD_T_WN   = 0x600006, /* CURLINFO_OFF_T + 6 */
    CURLINFO_CONTENT_TYPE_WN      = 0x100012, /* CURLINFO_STRING + 18 */
};

#pragma mark - WNCurlMonitor

@interface WNCurlMonitor ()
@property (nonatomic, weak) WNRemoteServer *server;
@property (nonatomic, assign) NSUInteger nextId;
@property (nonatomic, assign, readwrite) BOOL hookSucceeded;
- (void)reportCurlRequest:(NSString *)url
               statusCode:(long)statusCode
                totalTime:(NSTimeInterval)totalTime
              contentType:(nullable NSString *)contentType
                curlError:(int)curlError;
@end

#pragma mark - Hook storage

static CURLcode (*orig_curl_easy_perform)(CURL *handle) = NULL;

static __weak WNCurlMonitor *g_curlMonitor = nil;

#pragma mark - Hook implementation

static CURLcode wn_curl_easy_perform(CURL *handle) {
    if (!g_curlMonitor || !orig_curl_easy_perform) {
        return orig_curl_easy_perform ? orig_curl_easy_perform(handle) : -1;
    }

    typedef CURLcode (*GetInfoFn)(CURL *, CURLinfo, ...);
    GetInfoFn getInfoFn = dlsym(RTLD_DEFAULT, "curl_easy_getinfo");

    /* Extract the URL before the call */
    NSString *url = nil;
    if (getInfoFn) {
        char *urlStr = NULL;
        CURLcode rc = getInfoFn(handle, (CURLinfo)CURLINFO_EFFECTIVE_URL_WN, &urlStr);
        if (rc == CURLE_OK_WN && urlStr) {
            url = [NSString stringWithUTF8String:urlStr];
        }
    }

    NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];
    CURLcode result = orig_curl_easy_perform(handle);
    NSTimeInterval endTime = [[NSDate date] timeIntervalSince1970];

    /* Gather post-call info */
    long statusCode = 0;
    double totalTime = 0;
    NSString *contentType = nil;

    if (getInfoFn) {
        if (!url) {
            char *urlStr = NULL;
            if (getInfoFn(handle, (CURLinfo)CURLINFO_EFFECTIVE_URL_WN, &urlStr) == CURLE_OK_WN && urlStr) {
                url = [NSString stringWithUTF8String:urlStr];
            }
        }
        getInfoFn(handle, (CURLinfo)CURLINFO_RESPONSE_CODE_WN, &statusCode);
        getInfoFn(handle, (CURLinfo)CURLINFO_TOTAL_TIME_WN, &totalTime);

        char *ct = NULL;
        if (getInfoFn(handle, (CURLinfo)CURLINFO_CONTENT_TYPE_WN, &ct) == CURLE_OK_WN && ct) {
            contentType = [NSString stringWithUTF8String:ct];
        }
    }

    if (url) {
        [g_curlMonitor reportCurlRequest:url
                              statusCode:statusCode
                               totalTime:(totalTime > 0 ? totalTime : (endTime - startTime))
                             contentType:contentType
                               curlError:(result != CURLE_OK_WN ? result : 0)];
    }

    return result;
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
    /* First check if curl_easy_perform is available as a dynamic symbol */
    void *sym = dlsym(RTLD_DEFAULT, "curl_easy_perform");
    if (!sym) {
        NSLog(@"%@ curl_easy_perform symbol not found (likely statically linked). "
              @"knet request monitoring unavailable; host mapping via getaddrinfo still works.", kLogPrefix);
        self.hookSucceeded = NO;
        return;
    }

    struct rebinding rebindings[] = {
        {"curl_easy_perform", (void *)wn_curl_easy_perform, (void **)&orig_curl_easy_perform},
    };
    int rc = rebind_symbols(rebindings, 1);

    if (rc != 0 || orig_curl_easy_perform == NULL) {
        NSLog(@"%@ fishhook rebind failed for curl_easy_perform (rc=%d). "
              @"knet request monitoring unavailable; host mapping via getaddrinfo still works.", kLogPrefix, rc);
        self.hookSucceeded = NO;
        return;
    }

    self.hookSucceeded = YES;
    NSLog(@"%@ curl_easy_perform hook installed — knet requests will appear in network monitor", kLogPrefix);
}

- (void)reportCurlRequest:(NSString *)url
                statusCode:(long)statusCode
                 totalTime:(NSTimeInterval)totalTime
               contentType:(nullable NSString *)contentType
                 curlError:(int)curlError {

    NSString *reqId = [NSString stringWithFormat:@"curl_%lu", (unsigned long)self.nextId++];

    NSURL *parsed = [NSURL URLWithString:url];
    NSString *host = parsed.host ?: @"";
    NSString *method = @"GET";

    NSMutableDictionary *summary = [NSMutableDictionary dictionary];
    summary[@"id"]         = reqId;
    summary[@"method"]     = method;
    summary[@"url"]        = url;
    summary[@"host"]       = host;
    summary[@"status"]     = @(statusCode);
    summary[@"duration"]   = @(totalTime * 1000);
    summary[@"mimeType"]   = contentType ?: @"";
    summary[@"completed"]  = @YES;
    summary[@"source"]     = @"knet/curl";

    if (curlError != 0) {
        summary[@"error"] = [NSString stringWithFormat:@"CURLcode %d", curlError];
    }

    /* Broadcast both request and response in one shot since curl_easy_perform is synchronous */
    [self.server broadcastNotification:@"networkRequest" params:summary];
    [self.server broadcastNotification:@"networkResponse" params:summary];
}

@end
