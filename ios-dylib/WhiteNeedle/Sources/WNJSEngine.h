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

/// Async variants — do not block the caller; completion is called on the JS thread.
- (void)loadScriptAsync:(NSString *)code name:(NSString *)name completion:(void (^ _Nullable)(BOOL success))completion;
- (void)unloadScriptAsync:(NSString *)name completion:(void (^ _Nullable)(void))completion;
- (void)evaluateScriptAsync:(NSString *)code completion:(void (^ _Nullable)(NSString * _Nullable result))completion;

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
/// Run `block` on the main queue; pumps the JS run loop when called from the JS thread
/// so the thread remains available for hook callbacks / timers during the wait.
FOUNDATION_EXPORT void WNRunOnMainFromAnyThread(void (^ _Nonnull work)(void));

/// Execute `block` on `queue` while pumping the JS thread's run loop.
/// MUST be called from the JS thread.  The JS thread stays responsive (hook
/// callbacks, timers, etc. are processed) while the block runs on `queue`.
/// Falls back to dispatch_sync if not on the JS thread.
FOUNDATION_EXPORT void WNDispatchToQueuePumpingJSRunLoop(dispatch_queue_t _Nonnull queue,
                                                         dispatch_block_t _Nonnull block);

NS_ASSUME_NONNULL_END
