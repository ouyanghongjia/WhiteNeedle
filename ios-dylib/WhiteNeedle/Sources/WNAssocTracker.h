#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNAssocTracker — Tracks OBJC_ASSOCIATION_RETAIN(_NONATOMIC) associated objects
 * by hooking objc_setAssociatedObject / objc_removeAssociatedObjects via fishhook.
 *
 * Automatically detects FBAssociationManager and falls back to it when present.
 */
@interface WNAssocTracker : NSObject

+ (void)installIfSafe;
+ (void)uninstall;

/// All strongly-associated objects for a given host object.
/// @return [{ key(hex), address, className, source:"associated_object" }]
+ (NSArray<NSDictionary *> *)strongAssociationsForObject:(id)obj;

/// Whether the tracker is currently installed and active.
+ (BOOL)isInstalled;

@end

NS_ASSUME_NONNULL_END
