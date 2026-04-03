#import "WNAssocTracker.h"
#import "fishhook.h"
#import <objc/runtime.h>
#import <pthread.h>

static NSString *const kLogPrefix = @"[WNAssocTracker]";

#pragma mark - Storage

typedef struct {
    const void *key;
    id          value;
} WNAssocEntry;

static NSMapTable<id, NSMutableArray<NSValue *> *> *sAssocMap;
static pthread_mutex_t sAssocMutex = PTHREAD_MUTEX_INITIALIZER;
static BOOL sInstalled = NO;
static BOOL sUseFBFallback = NO;

#pragma mark - Original function pointers

static void (*orig_setAssocObj)(id object, const void *key, id value, objc_AssociationPolicy policy);
static void (*orig_removeAssocObjs)(id object);

#pragma mark - Hook replacements

static void wn_setAssocObj(id object, const void *key, id value, objc_AssociationPolicy policy) {
    orig_setAssocObj(object, key, value, policy);

    BOOL isStrong = (policy == OBJC_ASSOCIATION_RETAIN ||
                     policy == OBJC_ASSOCIATION_RETAIN_NONATOMIC);

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
}

static void wn_removeAssocObjs(id object) {
    orig_removeAssocObjs(object);

    pthread_mutex_lock(&sAssocMutex);
    [sAssocMap removeObjectForKey:object];
    pthread_mutex_unlock(&sAssocMutex);
}

#pragma mark - Implementation

@implementation WNAssocTracker

+ (void)installIfSafe {
    if (sInstalled) return;

    if (NSClassFromString(@"FBAssociationManager")) {
        NSLog(@"%@ FBRetainCycleDetector detected, delegating to FBAssociationManager", kLogPrefix);
        sUseFBFallback = YES;
        sInstalled = YES;
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
        return;
    }

    sInstalled = YES;
    NSLog(@"%@ Installed (fishhook)", kLogPrefix);
}

+ (void)uninstall {
    if (!sInstalled || sUseFBFallback) return;

    pthread_mutex_lock(&sAssocMutex);
    [sAssocMap removeAllObjects];
    sAssocMap = nil;
    pthread_mutex_unlock(&sAssocMutex);

    sInstalled = NO;
    NSLog(@"%@ Uninstalled", kLogPrefix);
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
