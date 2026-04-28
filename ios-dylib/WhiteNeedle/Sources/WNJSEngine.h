#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <dispatch/dispatch.h>

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
- (void)resetContext;

- (BOOL)loadScript:(NSString *)code name:(NSString *)name;
- (void)unloadScript:(NSString *)name;
- (nullable JSValue *)evaluateScript:(NSString *)code;
- (NSArray<NSString *> *)loadedScriptNames;

- (void)performOnJSThread:(dispatch_block_t)block waitUntilDone:(BOOL)waitUntilDone;
- (BOOL)isOnJSThread;
/// 唤醒 JS 执行线程的 RunLoop（在异步 `performOnJSThread:waitUntilDone:NO` 等场景下确保尽快处理队列）。
- (void)wakeJSThread;

- (void)addObserver:(id<WNJSEngineDelegate>)observer;
- (void)removeObserver:(id<WNJSEngineDelegate>)observer;

@end

/// True when a positive count of non-JS threads are blocked in -performOnJSThread:… waitUntilDone:YES
FOUNDATION_EXPORT BOOL WNIsExternalThreadWaitingOnJSThread(void);
/// True when the current thread is the JS thread and a synchronous `dispatch_get_main_queue()` would risk Main↔JS deadlock (another thread is waiting on the JS thread).
FOUNDATION_EXPORT BOOL WNShouldAvoidSynchronousMainFromJSThread(void);
/// Run `block` on the main queue. If deadlock would occur, schedules asynchronously and wakes the JS run loop (best-effort; no synchronous return value).
FOUNDATION_EXPORT void WNRunOnMainFromAnyThread(void (^ _Nonnull work)(void));

NS_ASSUME_NONNULL_END
