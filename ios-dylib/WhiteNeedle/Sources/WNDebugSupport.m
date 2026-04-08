#import "WNDebugSupport.h"
#import <objc/runtime.h>
#import <mach/mach.h>
#import <execinfo.h>

static NSString *const kLogPrefix = @"[WNDebugSupport]";

@implementation WNDebugSupport

+ (void)enableInspectorForContext:(JSContext *)context {
    // JSContext wraps a JSGlobalContextRef. On iOS with a debug build or
    // when connected to Safari Web Inspector, JSC can expose an inspector
    // for any JSContext that belongs to a named JSVirtualMachine.
    //
    // We use the private _debugger APIs when available:
    //   -[JSContext _setDebuggerRunLoop:]
    //   -[JSContext _setRemoteInspectionEnabled:]
    //
    // These exist on iOS but are not public. We call them via performSelector
    // to keep the code compiling without private header imports.
    
//    context.inspectable = YES;

    SEL remoteInspect = NSSelectorFromString(@"_setRemoteInspectionEnabled:");
    if ([context respondsToSelector:remoteInspect]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [context performSelector:remoteInspect withObject:@YES];
#pragma clang diagnostic pop
        NSLog(@"%@ Remote inspection enabled for JSContext", kLogPrefix);
    } else {
        NSLog(@"%@ Remote inspection API not available", kLogPrefix);
    }

    SEL setName = NSSelectorFromString(@"_setInjectedScriptSource:");
    (void)setName;

    // Give the context a name for identification in Safari
    SEL nameSelector = NSSelectorFromString(@"setName:");
    if ([context respondsToSelector:nameSelector]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [context performSelector:nameSelector withObject:@"WhiteNeedle"];
#pragma clang diagnostic pop
    }

    // Set the debugger run loop to the main run loop
    SEL setRunLoop = NSSelectorFromString(@"_setDebuggerRunLoop:");
    if ([context respondsToSelector:setRunLoop]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [context performSelector:setRunLoop withObject:(__bridge id)CFRunLoopGetMain()];
#pragma clang diagnostic pop
        NSLog(@"%@ Debugger run loop set to main", kLogPrefix);
    }
}

+ (void)registerInContext:(JSContext *)context {
    // Debug utilities available in scripts
    JSValue *debugNS = [JSValue valueWithNewObjectInContext:context];

    // Debug.breakpoint() — programmatic breakpoint (triggers debugger statement)
    debugNS[@"breakpoint"] = ^{
        JSContext *ctx = [JSContext currentContext];
        [ctx evaluateScript:@"debugger;"];
    };

    // Debug.log(level, ...args) — structured logging
    debugNS[@"log"] = ^(NSString *level, JSValue *message) {
        NSString *msg = [message toString];
        NSLog(@"[WN:%@] %@", level ?: @"debug", msg);
    };

    // Debug.trace() — print JS stack trace
    debugNS[@"trace"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        JSValue *error = [ctx evaluateScript:@"new Error()"];
        JSValue *stack = error[@"stack"];
        NSString *stackStr = [stack toString];
        NSLog(@"%@ Stack trace:\n%@", kLogPrefix, stackStr);
        return stack;
    };

    // Debug.time(label) / Debug.timeEnd(label)
    static NSMutableDictionary<NSString *, NSDate *> *timers;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        timers = [NSMutableDictionary new];
    });

    debugNS[@"time"] = ^(NSString *label) {
        timers[label ?: @"default"] = [NSDate date];
    };

    debugNS[@"timeEnd"] = ^JSValue *(NSString *label) {
        JSContext *ctx = [JSContext currentContext];
        NSString *key = label ?: @"default";
        NSDate *start = timers[key];
        if (!start) {
            NSLog(@"%@ Timer '%@' does not exist", kLogPrefix, key);
            return [JSValue valueWithUndefinedInContext:ctx];
        }
        NSTimeInterval elapsed = -[start timeIntervalSinceNow] * 1000.0;
        [timers removeObjectForKey:key];
        NSLog(@"%@ %@: %.2fms", kLogPrefix, key, elapsed);
        return [JSValue valueWithDouble:elapsed inContext:ctx];
    };

    // Debug.heapSize() — approximate JS heap usage
    debugNS[@"heapSize"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        struct task_basic_info info;
        mach_msg_type_number_t size = sizeof(info);
        kern_return_t kr = task_info(mach_task_self(), TASK_BASIC_INFO,
                                     (task_info_t)&info, &size);
        if (kr == KERN_SUCCESS) {
            return [JSValue valueWithObject:@{
                @"residentSize": @(info.resident_size),
                @"virtualSize": @(info.virtual_size),
            } inContext:ctx];
        }
        return [JSValue valueWithUndefinedInContext:ctx];
    };

    // Debug.nativeTrace(maxFrames?) — native (C/ObjC) call stack
    debugNS[@"nativeTrace"] = ^JSValue *(JSValue *maxFramesArg) {
        JSContext *ctx = [JSContext currentContext];
        int maxFrames = 128;
        if (maxFramesArg && ![maxFramesArg isUndefined] && ![maxFramesArg isNull]) {
            maxFrames = MAX(1, MIN([maxFramesArg toInt32], 256));
        }

        void **callstack = malloc(sizeof(void *) * maxFrames);
        int frames = backtrace(callstack, maxFrames);
        char **symbols = backtrace_symbols(callstack, frames);

        NSMutableArray *result = [NSMutableArray arrayWithCapacity:frames];
        for (int i = 0; i < frames; i++) {
            [result addObject:@(symbols[i])];
        }
        free(symbols);
        free(callstack);

        NSLog(@"%@ Native trace (%d frames)", kLogPrefix, frames);
        return [JSValue valueWithObject:result inContext:ctx];
    };

    // Debug.threads() — list all threads with basic info
    debugNS[@"threads"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        thread_array_t threadList;
        mach_msg_type_number_t threadCount;

        if (task_threads(mach_task_self(), &threadList, &threadCount) != KERN_SUCCESS) {
            return [JSValue valueWithObject:@[] inContext:ctx];
        }

        NSMutableArray *result = [NSMutableArray new];
        for (mach_msg_type_number_t i = 0; i < threadCount; i++) {
            thread_basic_info_data_t info;
            mach_msg_type_number_t infoCount = THREAD_BASIC_INFO_COUNT;
            if (thread_info(threadList[i], THREAD_BASIC_INFO,
                            (thread_info_t)&info, &infoCount) == KERN_SUCCESS) {
                [result addObject:@{
                    @"index": @(i),
                    @"userTime":   @(info.user_time.seconds + info.user_time.microseconds / 1e6),
                    @"systemTime": @(info.system_time.seconds + info.system_time.microseconds / 1e6),
                    @"cpuUsage":   @(info.cpu_usage / 10.0),
                    @"state":      @(info.run_state),
                    @"idle":       @(!!(info.flags & TH_FLAGS_IDLE)),
                }];
            }
        }

        vm_deallocate(mach_task_self(), (vm_address_t)threadList,
                      threadCount * sizeof(thread_t));

        return [JSValue valueWithObject:result inContext:ctx];
    };

    context[@"Debug"] = debugNS;
}

@end
