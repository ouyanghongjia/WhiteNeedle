#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNUIDebugBridge registers the UIDebug namespace into a JSContext.
 *
 * API:
 *   UIDebug.viewHierarchy()            → recursive view tree description
 *   UIDebug.screenshot()               → base64 PNG of key window
 *   UIDebug.screenshotView(address)    → base64 PNG of a specific UIView
 *   UIDebug.bounds(address)            → frame/bounds of a view by address
 *   UIDebug.keyWindow()                → info about the key window
 *   UIDebug.viewControllers()          → view controller hierarchy
 *   UIDebug.viewDetail(address)        → full property detail for a view
 *   UIDebug.setViewProperty(address, key, value) → modify view property
 *   UIDebug.highlightView(address)     → add colored border on device
 *   UIDebug.clearHighlight()           → remove all highlights
 *   UIDebug.searchViews(className)     → find views by class name
 */
@interface WNUIDebugBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (NSDictionary *)viewHierarchyTree;
+ (NSArray *)viewControllerStack;
+ (NSDictionary *)viewDetailForAddress:(NSString *)addr;
+ (BOOL)setViewProperty:(NSString *)addr key:(NSString *)key value:(id)value;
+ (BOOL)highlightView:(NSString *)addr;
+ (void)clearHighlight;
+ (NSArray *)searchViewsByClassName:(NSString *)className;
+ (NSString *)screenshotBase64;

@end

NS_ASSUME_NONNULL_END
