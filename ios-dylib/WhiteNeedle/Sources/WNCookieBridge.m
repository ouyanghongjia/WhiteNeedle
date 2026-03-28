#import "WNCookieBridge.h"

static NSString *const kLogPrefix = @"[WNCookieBridge]";

@implementation WNCookieBridge

+ (void)registerInContext:(JSContext *)context {
    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    ns[@"getAll"] = ^JSValue *(JSValue *domainFilter) {
        JSContext *ctx = [JSContext currentContext];
        NSString *domain = nil;
        if (domainFilter && ![domainFilter isUndefined] && ![domainFilter isNull]) {
            domain = [domainFilter toString];
        }

        NSArray<NSHTTPCookie *> *cookies = [[NSHTTPCookieStorage sharedHTTPCookieStorage] cookies];
        NSMutableArray *result = [NSMutableArray arrayWithCapacity:cookies.count];

        for (NSHTTPCookie *cookie in cookies) {
            if (domain && ![cookie.domain hasSuffix:domain]) continue;
            [result addObject:[self dictionaryFromCookie:cookie]];
        }

        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:@"name"
                                                               ascending:YES
                                                                selector:@selector(caseInsensitiveCompare:)];
        [result sortUsingDescriptors:@[sort]];

        return [JSValue valueWithObject:result inContext:ctx];
    };

    ns[@"get"] = ^JSValue *(NSString *name, JSValue *domainFilter) {
        JSContext *ctx = [JSContext currentContext];
        if (!name) return [JSValue valueWithNullInContext:ctx];

        NSString *domain = nil;
        if (domainFilter && ![domainFilter isUndefined] && ![domainFilter isNull]) {
            domain = [domainFilter toString];
        }

        for (NSHTTPCookie *cookie in [[NSHTTPCookieStorage sharedHTTPCookieStorage] cookies]) {
            if (![cookie.name isEqualToString:name]) continue;
            if (domain && ![cookie.domain hasSuffix:domain]) continue;
            return [JSValue valueWithObject:[self dictionaryFromCookie:cookie] inContext:ctx];
        }
        return [JSValue valueWithNullInContext:ctx];
    };

    ns[@"set"] = ^BOOL(JSValue *props) {
        if (!props || [props isUndefined] || [props isNull]) return NO;
        NSDictionary *dict = [props toDictionary];
        NSHTTPCookie *cookie = [self cookieFromDictionary:dict];
        if (!cookie) {
            NSLog(@"%@ Failed to create cookie from properties", kLogPrefix);
            return NO;
        }
        [[NSHTTPCookieStorage sharedHTTPCookieStorage] setCookie:cookie];
        return YES;
    };

    ns[@"remove"] = ^BOOL(NSString *name, NSString *domain) {
        if (!name || !domain) return NO;
        NSHTTPCookieStorage *storage = [NSHTTPCookieStorage sharedHTTPCookieStorage];
        for (NSHTTPCookie *cookie in [storage cookies]) {
            if ([cookie.name isEqualToString:name] && [cookie.domain isEqualToString:domain]) {
                [storage deleteCookie:cookie];
                return YES;
            }
        }
        return NO;
    };

    ns[@"clear"] = ^{
        NSHTTPCookieStorage *storage = [NSHTTPCookieStorage sharedHTTPCookieStorage];
        [storage removeCookiesSinceDate:[NSDate dateWithTimeIntervalSince1970:0]];
    };

    context[@"Cookies"] = ns;
    NSLog(@"%@ Cookies bridge registered", kLogPrefix);
}

#pragma mark - Cookie serialization

+ (NSDictionary *)dictionaryFromCookie:(NSHTTPCookie *)cookie {
    NSMutableDictionary *d = [NSMutableDictionary new];
    d[@"name"]        = cookie.name ?: @"";
    d[@"value"]       = cookie.value ?: @"";
    d[@"domain"]      = cookie.domain ?: @"";
    d[@"path"]        = cookie.path ?: @"/";
    d[@"isSecure"]    = @(cookie.isSecure);
    d[@"isHTTPOnly"]  = @(cookie.isHTTPOnly);
    d[@"isSessionOnly"] = @(cookie.sessionOnly);
    if (cookie.expiresDate) {
        d[@"expires"] = @([cookie.expiresDate timeIntervalSince1970]);
    }
    if (@available(iOS 13.0, *)) {
        d[@"sameSite"] = cookie.sameSitePolicy ?: @"";
    }
    return [d copy];
}

+ (NSHTTPCookie *)cookieFromDictionary:(NSDictionary *)dict {
    NSMutableDictionary *props = [NSMutableDictionary new];
    props[NSHTTPCookieName]   = dict[@"name"]   ?: @"";
    props[NSHTTPCookieDomain] = dict[@"domain"]  ?: @"";
    props[NSHTTPCookieValue]  = dict[@"value"]   ?: @"";
    props[NSHTTPCookiePath]   = dict[@"path"]    ?: @"/";

    if ([dict[@"isSecure"] boolValue])   props[NSHTTPCookieSecure] = @YES;
    if ([dict[@"isHTTPOnly"] boolValue]) props[@"HttpOnly"] = @YES;

    id expires = dict[@"expires"];
    if (expires && [expires doubleValue] > 0) {
        props[NSHTTPCookieExpires] = [NSDate dateWithTimeIntervalSince1970:[expires doubleValue]];
    }

    if (@available(iOS 13.0, *)) {
        if (dict[@"sameSite"]) {
            props[NSHTTPCookieSameSitePolicy] = dict[@"sameSite"];
        }
    }

    return [NSHTTPCookie cookieWithProperties:props];
}

@end
