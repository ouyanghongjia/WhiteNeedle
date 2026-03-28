#import "WNPerformanceBridge.h"
#import <mach/mach.h>
#import <QuartzCore/CADisplayLink.h>
#import <UIKit/UIKit.h>

static NSString *const kLogPrefix = @"[WNPerformanceBridge]";

@interface WNFPSMonitor : NSObject
@property (nonatomic, strong) CADisplayLink *displayLink;
@property (nonatomic, strong) JSManagedValue *callback;
@property (nonatomic, assign) NSUInteger frameCount;
@property (nonatomic, assign) CFTimeInterval lastTimestamp;
@property (nonatomic, weak)   JSContext *jsContext;
@end

@implementation WNFPSMonitor

- (void)startWithCallback:(JSValue *)cb inContext:(JSContext *)ctx {
    [self stop];
    self.jsContext = ctx;
    self.callback = [JSManagedValue managedValueWithValue:cb];
    [ctx.virtualMachine addManagedReference:self.callback withOwner:self];
    self.frameCount = 0;
    self.lastTimestamp = 0;
    self.displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];
    [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

- (void)stop {
    [self.displayLink invalidate];
    self.displayLink = nil;
    if (self.callback && self.jsContext) {
        [self.jsContext.virtualMachine removeManagedReference:self.callback withOwner:self];
    }
    self.callback = nil;
}

- (void)tick:(CADisplayLink *)link {
    if (self.lastTimestamp == 0) {
        self.lastTimestamp = link.timestamp;
        return;
    }
    self.frameCount++;
    CFTimeInterval elapsed = link.timestamp - self.lastTimestamp;
    if (elapsed >= 1.0) {
        double fps = self.frameCount / elapsed;
        self.frameCount = 0;
        self.lastTimestamp = link.timestamp;

        JSValue *fn = self.callback.value;
        if (fn && ![fn isUndefined]) {
            [fn callWithArguments:@[@(round(fps))]];
        }
    }
}

@end

static WNFPSMonitor *sFPSMonitor = nil;

@implementation WNPerformanceBridge

+ (void)registerInContext:(JSContext *)context {
    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    ns[@"memory"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        struct mach_task_basic_info info;
        mach_msg_type_number_t size = MACH_TASK_BASIC_INFO_COUNT;
        kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                                     (task_info_t)&info, &size);
        if (kr != KERN_SUCCESS) {
            return [JSValue valueWithNullInContext:ctx];
        }

        vm_size_t freeBytes = 0;
        vm_statistics64_data_t vmStats;
        mach_msg_type_number_t vmCount = HOST_VM_INFO64_COUNT;
        if (host_statistics64(mach_host_self(), HOST_VM_INFO64,
                              (host_info64_t)&vmStats, &vmCount) == KERN_SUCCESS) {
            freeBytes = vmStats.free_count * vm_page_size;
        }

        return [JSValue valueWithObject:@{
            @"used":    @(info.resident_size),
            @"virtual": @(info.virtual_size),
            @"free":    @(freeBytes),
        } inContext:ctx];
    };

    ns[@"cpu"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        thread_array_t threadList;
        mach_msg_type_number_t threadCount;

        if (task_threads(mach_task_self(), &threadList, &threadCount) != KERN_SUCCESS) {
            return [JSValue valueWithNullInContext:ctx];
        }

        double totalUser = 0, totalSystem = 0;
        for (mach_msg_type_number_t i = 0; i < threadCount; i++) {
            thread_basic_info_data_t threadInfo;
            mach_msg_type_number_t infoCount = THREAD_BASIC_INFO_COUNT;
            if (thread_info(threadList[i], THREAD_BASIC_INFO,
                            (thread_info_t)&threadInfo, &infoCount) == KERN_SUCCESS) {
                if (!(threadInfo.flags & TH_FLAGS_IDLE)) {
                    totalUser   += threadInfo.user_time.seconds + threadInfo.user_time.microseconds / 1e6;
                    totalSystem += threadInfo.system_time.seconds + threadInfo.system_time.microseconds / 1e6;
                }
            }
        }

        vm_deallocate(mach_task_self(), (vm_address_t)threadList,
                      threadCount * sizeof(thread_t));

        return [JSValue valueWithObject:@{
            @"userTime":   @(totalUser),
            @"systemTime": @(totalSystem),
            @"threadCount": @(threadCount),
        } inContext:ctx];
    };

    ns[@"fps"] = ^(JSValue *cb) {
        if (!cb || [cb isUndefined] || [cb isNull]) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!sFPSMonitor) sFPSMonitor = [WNFPSMonitor new];
            [sFPSMonitor startWithCallback:cb inContext:[JSContext currentContext]];
        });
    };

    ns[@"stopFps"] = ^{
        dispatch_async(dispatch_get_main_queue(), ^{
            [sFPSMonitor stop];
            sFPSMonitor = nil;
        });
    };

    ns[@"snapshot"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        JSValue *mem = [ctx[@"Performance"][@"memory"] callWithArguments:@[]];
        JSValue *cpu = [ctx[@"Performance"][@"cpu"] callWithArguments:@[]];
        return [JSValue valueWithObject:@{
            @"memory":    [mem toObject] ?: [NSNull null],
            @"cpu":       [cpu toObject] ?: [NSNull null],
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
        } inContext:ctx];
    };

    context[@"Performance"] = ns;
    NSLog(@"%@ Performance bridge registered", kLogPrefix);
}

@end
