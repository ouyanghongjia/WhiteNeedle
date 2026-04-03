#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNCollectionEnumerator — Enumerates strong references held inside
 * Foundation collection containers (NSArray, NSDictionary, NSSet, NSHashTable,
 * NSMapTable, NSPointerArray with strong options).
 */
@interface WNCollectionEnumerator : NSObject

/// Strong object references contained in a collection.
/// @return [{ index|key, address, className, source:"collection_element" }]
+ (NSArray<NSDictionary *> *)strongReferencesInCollection:(id)collection;

/// YES if `obj` is a recognized collection type that this enumerator handles.
+ (BOOL)isCollection:(id)obj;

@end

NS_ASSUME_NONNULL_END
