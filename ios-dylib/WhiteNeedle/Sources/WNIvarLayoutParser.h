#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNIvarLayoutParser — Precise strong-reference ivar extraction
 * using class_getIvarLayout / class_getWeakIvarLayout.
 *
 * Replaces the naive `type_encoding[0] == '@'` heuristic with
 * Apple's ivar layout bitmap to distinguish strong vs weak vs
 * unretained object ivars.
 */
@interface WNIvarLayoutParser : NSObject

/// All strong-reference ivars for an object instance.
/// @return [{ name, type, offset, address, className, source:"ivar" }]
+ (NSArray<NSDictionary *> *)strongIvarReferencesForObject:(id)obj;

/// Raw byte-offsets of strong object slots for a class hierarchy.
+ (NSArray<NSNumber *> *)strongIvarOffsetsForClass:(Class)cls;

@end

NS_ASSUME_NONNULL_END
