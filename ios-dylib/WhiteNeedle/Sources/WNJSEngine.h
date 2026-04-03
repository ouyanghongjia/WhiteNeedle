#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@protocol WNJSEngineDelegate <NSObject>
@optional
- (void)jsEngine:(id)engine didReceiveConsoleMessage:(NSString *)message level:(NSString *)level;
- (void)jsEngine:(id)engine didReceiveScriptError:(NSString *)error;
@end

@interface WNJSEngine : NSObject

@property (nonatomic, readonly) JSContext *context;
@property (nonatomic, weak, nullable) id<WNJSEngineDelegate> delegate;
@property (nonatomic, readonly) BOOL isReady;

+ (instancetype)sharedEngine;

- (void)setup;
- (void)teardown;

- (BOOL)loadScript:(NSString *)code name:(NSString *)name;
- (void)unloadScript:(NSString *)name;
- (nullable JSValue *)evaluateScript:(NSString *)code;
- (NSArray<NSString *> *)loadedScriptNames;

- (void)addObserver:(id<WNJSEngineDelegate>)observer;
- (void)removeObserver:(id<WNJSEngineDelegate>)observer;

@end

NS_ASSUME_NONNULL_END
