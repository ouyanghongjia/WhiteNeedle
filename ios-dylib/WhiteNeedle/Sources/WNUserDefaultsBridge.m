#import "WNUserDefaultsBridge.h"

static NSString *const kLogPrefix = @"[WNUserDefaultsBridge]";
static NSMutableDictionary<NSString *, NSUserDefaults *> *sSuiteCache = nil;

static NSArray<NSString *> *sSystemKeyPrefixes = nil;
static NSArray<NSString *> *sSystemKeyExact = nil;

@implementation WNUserDefaultsBridge

+ (NSArray<NSString *> *)systemKeyPrefixes {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sSystemKeyPrefixes = @[
            @"Apple",           // AppleLanguages, AppleLocale, AppleKeyboards, ApplePasscodeKeyboards, etc.
            @"NS",              // NSLanguages, NSInterfaceStyle, NSContentSizeCategory, etc.
            @"AK",              // Apple Keychain/Account Kit internal
            @"com.apple.",      // Apple domain preferences
            @"WebKit",          // WebKit internal preferences
            @"PK",              // PassKit / StockholmSettings
            @"IN",              // Intents framework (INNextHearbeatDate, etc.)
            @"MultiPath",       // Multipath TCP settings
            @"_",               // Private/internal keys
            @"LS",              // LaunchServices
            @"CK",              // CloudKit internal
            @"MF",              // MessageFilter
            @"MT",              // Metal/system
            @"SB",              // SpringBoard
            @"UIKit",           // UIKit internal
            @"MSV",             // MessagesVersion
        ];
        sSystemKeyExact = @[
            @"AddingEmojiKeybordHandled",
            @"ConstraintLayoutGuideDebugMode",
        ];
    });
    return sSystemKeyPrefixes;
}

+ (BOOL)isSystemKey:(NSString *)key {
    if (!key || key.length == 0) return NO;
    for (NSString *prefix in [self systemKeyPrefixes]) {
        if ([key hasPrefix:prefix]) return YES;
    }
    for (NSString *exact in sSystemKeyExact) {
        if ([key isEqualToString:exact]) return YES;
    }
    return NO;
}

+ (NSDictionary *)filterSystemKeys:(NSDictionary *)dict {
    NSMutableDictionary *filtered = [NSMutableDictionary dictionaryWithCapacity:dict.count];
    [dict enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
        NSString *keyStr = [key description];
        if (![self isSystemKey:keyStr]) {
            filtered[keyStr] = value;
        }
    }];
    return filtered;
}

+ (void)registerInContext:(JSContext *)context {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sSuiteCache = [NSMutableDictionary new];
    });

    [self systemKeyPrefixes];

    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    ns[@"suites"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        NSString *prefsDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Preferences"];
        NSError *error = nil;
        NSArray<NSString *> *files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:prefsDir error:&error];
        if (error) {
            NSLog(@"%@ Failed to list suites: %@", kLogPrefix, error.localizedDescription);
            return [JSValue valueWithObject:@[] inContext:ctx];
        }

        NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
        NSMutableArray *result = [NSMutableArray new];
        for (NSString *file in files) {
            if (![file.pathExtension isEqualToString:@"plist"]) continue;
            NSString *suite = file.stringByDeletingPathExtension;
            NSString *plistPath = [prefsDir stringByAppendingPathComponent:file];
            NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:plistPath];
            NSUInteger keyCount = plist.count;
            NSDictionary *filtered = [self filterSystemKeys:(plist ?: @{})];
            [result addObject:@{
                @"suiteName": suite,
                @"name": suite,
                @"isDefault": @([suite isEqualToString:bundleId]),
                @"keyCount": @(keyCount),
                @"appKeyCount": @(filtered.count),
            }];
        }
        return [JSValue valueWithObject:result inContext:ctx];
    };

    ns[@"getAll"] = ^JSValue *(JSValue *suiteArg) {
        JSContext *ctx = [JSContext currentContext];
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        NSDictionary *dict = [ud dictionaryRepresentation];
        return [JSValue valueWithObject:[self jsonSafe:dict] inContext:ctx];
    };

    ns[@"getAllApp"] = ^JSValue *(JSValue *suiteArg) {
        JSContext *ctx = [JSContext currentContext];
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        NSDictionary *dict = [ud dictionaryRepresentation];
        NSDictionary *filtered = [self filterSystemKeys:dict];
        return [JSValue valueWithObject:[self jsonSafe:filtered] inContext:ctx];
    };

    ns[@"systemKeyPrefixes"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        return [JSValue valueWithObject:sSystemKeyPrefixes inContext:ctx];
    };

    ns[@"isSystemKey"] = ^BOOL(NSString *key) {
        return [self isSystemKey:key];
    };

    ns[@"get"] = ^JSValue *(NSString *key, JSValue *suiteArg) {
        JSContext *ctx = [JSContext currentContext];
        if (!key) return [JSValue valueWithUndefinedInContext:ctx];
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        id value = [ud objectForKey:key];
        if (!value) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:[self jsonSafe:value] inContext:ctx];
    };

    ns[@"set"] = ^BOOL(NSString *key, JSValue *valueArg, JSValue *suiteArg) {
        if (!key) return NO;
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        if (!valueArg || [valueArg isUndefined] || [valueArg isNull]) {
            [ud removeObjectForKey:key];
        } else {
            [ud setObject:[valueArg toObject] forKey:key];
        }
        [ud synchronize];
        return YES;
    };

    ns[@"remove"] = ^BOOL(NSString *key, JSValue *suiteArg) {
        if (!key) return NO;
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        [ud removeObjectForKey:key];
        [ud synchronize];
        return YES;
    };

    ns[@"clear"] = ^(JSValue *suiteArg) {
        NSString *suiteName = [self suiteNameFromArg:suiteArg];
        NSUserDefaults *ud = [self resolveDefaults:suiteArg];
        [ud removePersistentDomainForName:suiteName];
        [ud synchronize];
    };

    context[@"UserDefaults"] = ns;
    NSLog(@"%@ UserDefaults bridge registered", kLogPrefix);
}

#pragma mark - Helpers

+ (NSString *)suiteNameFromArg:(JSValue *)arg {
    if (arg && ![arg isUndefined] && ![arg isNull]) {
        NSString *s = [arg toString];
        if (s.length > 0) return s;
    }
    return [[NSBundle mainBundle] bundleIdentifier] ?: @"";
}

+ (NSUserDefaults *)resolveDefaults:(JSValue *)suiteArg {
    NSString *suite = [self suiteNameFromArg:suiteArg];
    NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
    if ([suite isEqualToString:bundleId] || suite.length == 0) {
        return [NSUserDefaults standardUserDefaults];
    }

    NSUserDefaults *cached = sSuiteCache[suite];
    if (!cached) {
        cached = [[NSUserDefaults alloc] initWithSuiteName:suite];
        sSuiteCache[suite] = cached;
    }
    return cached;
}

+ (id)jsonSafe:(id)obj {
    if ([obj isKindOfClass:[NSDictionary class]]) {
        NSMutableDictionary *safe = [NSMutableDictionary new];
        [(NSDictionary *)obj enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
            safe[[key description]] = [self jsonSafe:value];
        }];
        return safe;
    }
    if ([obj isKindOfClass:[NSArray class]]) {
        NSMutableArray *safe = [NSMutableArray new];
        for (id item in (NSArray *)obj) {
            [safe addObject:[self jsonSafe:item]];
        }
        return safe;
    }
    if ([obj isKindOfClass:[NSData class]]) {
        return [NSString stringWithFormat:@"<NSData %lu bytes>", (unsigned long)[(NSData *)obj length]];
    }
    if ([obj isKindOfClass:[NSDate class]]) {
        return [NSString stringWithFormat:@"%@", obj];
    }
    if ([obj isKindOfClass:[NSString class]] || [obj isKindOfClass:[NSNumber class]]) {
        return obj;
    }
    return [NSString stringWithFormat:@"%@", obj];
}

@end
