#import "WNAssocTracker.h"
#import "fishhook.h"
#import <objc/runtime.h>
#import <pthread.h>
#import <dlfcn.h>

static NSString *const kLogPrefix = @"[WNAssocTracker]";

#pragma mark - Storage

typedef struct {
    const void *key;
    id          value;
} WNAssocEntry;

static NSMapTable<id, NSMutableArray<NSValue *> *> *sAssocMap;
static pthread_mutex_t sAssocMutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t sInstallMutex = PTHREAD_MUTEX_INITIALIZER;
static BOOL sInstalled = NO;
static BOOL sUseFBFallback = NO;

#pragma mark - Original function pointers

static void (*orig_setAssocObj)(id object, const void *key, id value, objc_AssociationPolicy policy);
static void (*orig_removeAssocObjs)(id object);
static void (*sRuntimeSetAssocObj)(id object, const void *key, id value, objc_AssociationPolicy policy);
static void (*sRuntimeRemoveAssocObjs)(id object);
static pthread_once_t sRuntimeLookupOnce = PTHREAD_ONCE_INIT;

#pragma mark - Hook replacements

static _Thread_local BOOL sReentrant = NO;

static void wn_resolveRuntimeAssocFns(void) {
    sRuntimeSetAssocObj = (void (*)(id, const void *, id, objc_AssociationPolicy))dlsym(RTLD_DEFAULT, "objc_setAssociatedObject");
    sRuntimeRemoveAssocObjs = (void (*)(id))dlsym(RTLD_DEFAULT, "objc_removeAssociatedObjects");
}

static void wn_setAssocObj(id object, const void *key, id value, objc_AssociationPolicy policy) {
    void (*setAssocFn)(id, const void *, id, objc_AssociationPolicy) = orig_setAssocObj;
    if (!setAssocFn || setAssocFn == wn_setAssocObj) {
        pthread_once(&sRuntimeLookupOnce, wn_resolveRuntimeAssocFns);
        setAssocFn = sRuntimeSetAssocObj;
    }

    if (!setAssocFn || setAssocFn == wn_setAssocObj) {
        NSLog(@"%@ objc_setAssociatedObject hook skipped due to invalid original function", kLogPrefix);
        return;
    }
    setAssocFn(object, key, value, policy);

    if (!sAssocMap || sReentrant || object_isClass(object)) return;

    BOOL isStrong = (policy == OBJC_ASSOCIATION_RETAIN ||
                     policy == OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    sReentrant = YES;
    pthread_mutex_lock(&sAssocMutex);
    @try {
        NSMutableArray<NSValue *> *entries = [sAssocMap objectForKey:object];

        NSInteger existingIdx = NSNotFound;
        if (entries) {
            for (NSInteger i = 0; i < (NSInteger)entries.count; i++) {
                WNAssocEntry e;
                [entries[i] getValue:&e];
                if (e.key == key) { existingIdx = i; break; }
            }
        }

        if (isStrong && value) {
            WNAssocEntry entry = { .key = key, .value = value };
            NSValue *boxed = [NSValue value:&entry withObjCType:@encode(WNAssocEntry)];

            if (!entries) {
                entries = [NSMutableArray array];
                [sAssocMap setObject:entries forKey:object];
            }

            if (existingIdx != NSNotFound) {
                entries[existingIdx] = boxed;
            } else {
                [entries addObject:boxed];
            }
        } else {
            if (entries && existingIdx != NSNotFound) {
                [entries removeObjectAtIndex:existingIdx];
                if (entries.count == 0) {
                    [sAssocMap removeObjectForKey:object];
                }
            }
        }
    } @catch (NSException *e) {
        NSLog(@"%@ Exception in hook: %@", kLogPrefix, e);
    }
    pthread_mutex_unlock(&sAssocMutex);
    sReentrant = NO;
}

static void wn_removeAssocObjs(id object) {
    void (*removeAssocFn)(id) = orig_removeAssocObjs;
    if (!removeAssocFn || removeAssocFn == wn_removeAssocObjs) {
        pthread_once(&sRuntimeLookupOnce, wn_resolveRuntimeAssocFns);
        removeAssocFn = sRuntimeRemoveAssocObjs;
    }

    if (!removeAssocFn || removeAssocFn == wn_removeAssocObjs) {
        NSLog(@"%@ objc_removeAssociatedObjects hook skipped due to invalid original function", kLogPrefix);
        return;
    }
    removeAssocFn(object);

    if (!sAssocMap || sReentrant || object_isClass(object)) return;

    sReentrant = YES;
    pthread_mutex_lock(&sAssocMutex);
    [sAssocMap removeObjectForKey:object];
    pthread_mutex_unlock(&sAssocMutex);
    sReentrant = NO;
}

#pragma mark - Implementation

@implementation WNAssocTracker

+ (void)installIfSafe {
    pthread_mutex_lock(&sInstallMutex);
    if (sInstalled) {
        pthread_mutex_unlock(&sInstallMutex);
        return;
    }

    if (NSClassFromString(@"FBAssociationManager")) {
        NSLog(@"%@ FBRetainCycleDetector detected, delegating to FBAssociationManager", kLogPrefix);
        sUseFBFallback = YES;
        sInstalled = YES;
        pthread_mutex_unlock(&sInstallMutex);
        return;
    }

    sAssocMap = [NSMapTable mapTableWithKeyOptions:NSPointerFunctionsWeakMemory | NSPointerFunctionsObjectPointerPersonality
                                      valueOptions:NSPointerFunctionsStrongMemory];

    struct rebinding rebindings[] = {
        {"objc_setAssociatedObject",    (void *)wn_setAssocObj,     (void **)&orig_setAssocObj},
        {"objc_removeAssociatedObjects",(void *)wn_removeAssocObjs, (void **)&orig_removeAssocObjs},
    };

    int result = rebind_symbols(rebindings, 2);
    if (result != 0) {
        NSLog(@"%@ rebind_symbols failed: %d", kLogPrefix, result);
        pthread_mutex_unlock(&sInstallMutex);
        return;
    }

    sInstalled = YES;
    NSLog(@"%@ Installed (fishhook)", kLogPrefix);
    pthread_mutex_unlock(&sInstallMutex);
}

+ (void)uninstall {
    pthread_mutex_lock(&sInstallMutex);
    if (!sInstalled || sUseFBFallback) {
        pthread_mutex_unlock(&sInstallMutex);
        return;
    }

    pthread_mutex_lock(&sAssocMutex);
    [sAssocMap removeAllObjects];
    sAssocMap = nil;
    pthread_mutex_unlock(&sAssocMutex);

    sInstalled = NO;
    NSLog(@"%@ Uninstalled", kLogPrefix);
    pthread_mutex_unlock(&sInstallMutex);
}

+ (BOOL)isInstalled {
    return sInstalled;
}

+ (NSArray<NSDictionary *> *)strongAssociationsForObject:(id)obj {
    if (!obj || !sInstalled) return @[];

    if (sUseFBFallback) {
        return [self fbFallbackForObject:obj];
    }

    NSMutableArray *results = [NSMutableArray array];

    pthread_mutex_lock(&sAssocMutex);
    @try {
        NSMutableArray<NSValue *> *entries = [sAssocMap objectForKey:obj];
        for (NSValue *boxed in entries) {
            WNAssocEntry entry;
            [boxed getValue:&entry];
            if (!entry.value) continue;

            NSString *className = NSStringFromClass([entry.value class]) ?: @"?";
            [results addObject:@{
                @"key":       [NSString stringWithFormat:@"0x%lx", (unsigned long)entry.key],
                @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)(uintptr_t)(__bridge void *)entry.value],
                @"className": className,
                @"source":    @"associated_object",
            }];
        }
    } @catch (NSException *e) {
        NSLog(@"%@ Exception reading associations: %@", kLogPrefix, e);
    }
    pthread_mutex_unlock(&sAssocMutex);

    return [results copy];
}

#pragma mark - FBAssociationManager fallback

+ (NSArray<NSDictionary *> *)fbFallbackForObject:(id)obj {
    Class fbClass = NSClassFromString(@"FBAssociationManager");
    if (!fbClass) return @[];

    SEL sel = NSSelectorFromString(@"associationsForObject:");
    if (![fbClass respondsToSelector:sel]) return @[];

    NSDictionary *assocs = nil;
    @try {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        assocs = [fbClass performSelector:sel withObject:obj];
#pragma clang diagnostic pop
    } @catch (NSException *e) {
        return @[];
    }

    if (![assocs isKindOfClass:[NSDictionary class]]) return @[];

    NSMutableArray *results = [NSMutableArray array];
    [assocs enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
        if (!value) return;
        NSString *className = NSStringFromClass([value class]) ?: @"?";
        [results addObject:@{
            @"key":       [NSString stringWithFormat:@"%@", key],
            @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)(uintptr_t)(__bridge void *)value],
            @"className": className,
            @"source":    @"associated_object",
        }];
    }];

    return [results copy];
}

@end
