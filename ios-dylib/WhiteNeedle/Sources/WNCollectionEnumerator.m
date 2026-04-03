#import "WNCollectionEnumerator.h"

static const NSUInteger kMaxElementsPerCollection = 1024;

@implementation WNCollectionEnumerator

+ (BOOL)isCollection:(id)obj {
    return ([obj isKindOfClass:[NSArray class]] ||
            [obj isKindOfClass:[NSDictionary class]] ||
            [obj isKindOfClass:[NSSet class]] ||
            [obj isKindOfClass:[NSHashTable class]] ||
            [obj isKindOfClass:[NSMapTable class]] ||
            [obj isKindOfClass:[NSPointerArray class]]);
}

+ (NSArray<NSDictionary *> *)strongReferencesInCollection:(id)collection {
    if (!collection) return @[];

    @try {
        if ([collection isKindOfClass:[NSArray class]])       return [self enumerateArray:collection];
        if ([collection isKindOfClass:[NSDictionary class]])  return [self enumerateDictionary:collection];
        if ([collection isKindOfClass:[NSSet class]])         return [self enumerateSet:collection];
        if ([collection isKindOfClass:[NSHashTable class]])   return [self enumerateHashTable:collection];
        if ([collection isKindOfClass:[NSMapTable class]])    return [self enumerateMapTable:collection];
        if ([collection isKindOfClass:[NSPointerArray class]])return [self enumeratePointerArray:collection];
    } @catch (NSException *e) {
        NSLog(@"[WNCollectionEnumerator] Exception: %@", e);
    }

    return @[];
}

#pragma mark - NSArray

+ (NSArray<NSDictionary *> *)enumerateArray:(NSArray *)array {
    NSMutableArray *results = [NSMutableArray array];
    NSUInteger limit = MIN(array.count, kMaxElementsPerCollection);

    for (NSUInteger i = 0; i < limit; i++) {
        id element = array[i];
        if (!element) continue;
        [results addObject:[self entryWithKey:[NSString stringWithFormat:@"%lu", (unsigned long)i]
                                       value:element]];
    }
    return results;
}

#pragma mark - NSDictionary

+ (NSArray<NSDictionary *> *)enumerateDictionary:(NSDictionary *)dict {
    NSMutableArray *results = [NSMutableArray array];
    __block NSUInteger count = 0;

    [dict enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
        if (count >= kMaxElementsPerCollection) { *stop = YES; return; }

        if ([key isKindOfClass:[NSObject class]]) {
            [results addObject:[self entryWithKey:[NSString stringWithFormat:@"key:%@", key]
                                           value:key]];
        }
        [results addObject:[self entryWithKey:[NSString stringWithFormat:@"val:%@", key]
                                       value:value]];
        count++;
    }];
    return results;
}

#pragma mark - NSSet

+ (NSArray<NSDictionary *> *)enumerateSet:(NSSet *)set {
    NSMutableArray *results = [NSMutableArray array];
    __block NSUInteger count = 0;

    for (id element in set) {
        if (count >= kMaxElementsPerCollection) break;
        [results addObject:[self entryWithKey:[NSString stringWithFormat:@"set#%lu", (unsigned long)count]
                                       value:element]];
        count++;
    }
    return results;
}

#pragma mark - NSHashTable

+ (NSArray<NSDictionary *> *)enumerateHashTable:(NSHashTable *)table {
    // NSHashTable.weakObjectsHashTable uses NSPointerFunctionsWeakMemory;
    // weak refs don't contribute to retain cycles — skip them.
    if ([table isEqual:[NSHashTable weakObjectsHashTable]]) return @[];

    NSMutableArray *results = [NSMutableArray array];
    NSUInteger count = 0;

    NSArray *snapshot = table.allObjects;
    NSUInteger limit = MIN(snapshot.count, kMaxElementsPerCollection);
    for (NSUInteger i = 0; i < limit; i++) {
        id element = snapshot[i];
        if (!element) continue;
        [results addObject:[self entryWithKey:[NSString stringWithFormat:@"hash#%lu", (unsigned long)count]
                                       value:element]];
        count++;
    }
    return results;
}

#pragma mark - NSMapTable

+ (NSArray<NSDictionary *> *)enumerateMapTable:(NSMapTable *)table {
    NSMutableArray *results = [NSMutableArray array];
    NSUInteger count = 0;

    NSArray *keys = [[table keyEnumerator] allObjects];
    NSUInteger limit = MIN(keys.count, kMaxElementsPerCollection);
    for (NSUInteger i = 0; i < limit; i++) {
        id key = keys[i];
        if (!key) continue;

        id value = [table objectForKey:key];
        if (value) {
            [results addObject:[self entryWithKey:[NSString stringWithFormat:@"mapVal:%@", key]
                                           value:value]];
        }
        count++;
    }
    return results;
}

#pragma mark - NSPointerArray

+ (NSArray<NSDictionary *> *)enumeratePointerArray:(NSPointerArray *)array {
    NSMutableArray *results = [NSMutableArray array];
    NSUInteger limit = MIN(array.count, kMaxElementsPerCollection);

    for (NSUInteger i = 0; i < limit; i++) {
        @try {
            void *ptr = [array pointerAtIndex:i];
            if (!ptr) continue;

            id obj = (__bridge id)ptr;
            [results addObject:[self entryWithKey:[NSString stringWithFormat:@"ptr#%lu", (unsigned long)i]
                                           value:obj]];
        } @catch (NSException *e) {
            continue;
        }
    }
    return results;
}

#pragma mark - Helpers

+ (NSDictionary *)entryWithKey:(NSString *)key value:(id)value {
    return @{
        @"key":       key,
        @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)(uintptr_t)(__bridge void *)value],
        @"className": NSStringFromClass([value class]) ?: @"?",
        @"source":    @"collection_element",
    };
}

@end
