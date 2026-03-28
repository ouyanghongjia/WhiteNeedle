#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNModuleLoader : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (void)setModuleSearchPaths:(NSArray<NSString *> *)paths;

+ (void)registerBuiltinModule:(NSString *)name source:(NSString *)source;

@end

NS_ASSUME_NONNULL_END
