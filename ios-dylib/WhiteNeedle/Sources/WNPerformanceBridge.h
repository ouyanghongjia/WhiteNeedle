#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNPerformanceBridge registers the Performance namespace into a JSContext.
 *
 * API:
 *   Performance.memory()    → { used, total, free } in bytes (task_info)
 *   Performance.cpu()       → { user, system } CPU time (task_threads_info)
 *   Performance.fps(cb)     → start FPS monitor, calls cb(fps) each second
 *   Performance.stopFps()   → stop FPS monitor
 *   Performance.snapshot()  → combined { memory, cpu, timestamp }
 */
@interface WNPerformanceBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
