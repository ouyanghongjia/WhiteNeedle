#import "WNLeakExamples.h"

#pragma mark - Retain Cycle A ↔ B

@implementation WNRetainCycleA
- (void)dealloc {
    NSLog(@"[LeakExample] WNRetainCycleA dealloc (%@)", self.label);
}
@end

@implementation WNRetainCycleB
- (void)dealloc {
    NSLog(@"[LeakExample] WNRetainCycleB dealloc (%@)", self.label);
}
@end

#pragma mark - Timer Leaker

@implementation WNTimerLeaker

+ (instancetype)startLeaking {
    WNTimerLeaker *obj = [[WNTimerLeaker alloc] init];
    obj.data = [NSMutableArray arrayWithCapacity:100];
    for (int i = 0; i < 100; i++) {
        [obj.data addObject:[@(i) stringValue]];
    }
    obj.timer = [NSTimer scheduledTimerWithTimeInterval:3600
                                                 target:obj
                                               selector:@selector(timerFired:)
                                               userInfo:nil
                                                repeats:YES];
    return obj;
}

- (void)timerFired:(NSTimer *)timer {
    // no-op
}

- (void)dealloc {
    NSLog(@"[LeakExample] WNTimerLeaker dealloc");
}

@end

#pragma mark - Block Capture Leak

@implementation WNBlockCaptureLeak

+ (instancetype)createLeaky {
    WNBlockCaptureLeak *obj = [[WNBlockCaptureLeak alloc] init];
    obj.name = @"I am leaking";
    obj.callback = ^{
        NSLog(@"Captured name: %@", obj.name);
    };
    return obj;
}

- (void)dealloc {
    NSLog(@"[LeakExample] WNBlockCaptureLeak dealloc (%@)", self.name);
}

@end

#pragma mark - Orphaned Object

@implementation WNOrphanedObject

- (void)dealloc {
    NSLog(@"[LeakExample] WNOrphanedObject dealloc (#%lu)", (unsigned long)self.sequence);
}

@end

#pragma mark - Factory

static NSMutableArray *sOrphanedPool = nil;

@implementation WNLeakExamples

+ (void)createRetainCycle {
    WNRetainCycleA *a = [[WNRetainCycleA alloc] init];
    a.label = @"CycleNode-A";
    WNRetainCycleB *b = [[WNRetainCycleB alloc] init];
    b.label = @"CycleNode-B";

    a.partnerB = b;
    b.partnerA = a;

    NSLog(@"[LeakExample] Created retain cycle: A(%p) <-> B(%p)", a, b);
}

+ (void)createTimerLeak {
    __attribute__((unused)) WNTimerLeaker *leaker = [WNTimerLeaker startLeaking];
    NSLog(@"[LeakExample] Created timer leak: %p (timer retains target)", leaker);
}

+ (void)createBlockCaptureLeak {
    __attribute__((unused)) WNBlockCaptureLeak *leaker = [WNBlockCaptureLeak createLeaky];
    NSLog(@"[LeakExample] Created block capture leak: %p", leaker);
}

+ (void)accumulateOrphanedObjects:(NSUInteger)count {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sOrphanedPool = [NSMutableArray array];
    });

    NSUInteger base = sOrphanedPool.count;
    for (NSUInteger i = 0; i < count; i++) {
        WNOrphanedObject *obj = [[WNOrphanedObject alloc] init];
        obj.sequence = base + i;
        obj.payload = [[NSMutableData alloc] initWithLength:1024];
        [sOrphanedPool addObject:obj];
    }
    NSLog(@"[LeakExample] Accumulated %lu orphaned objects (total: %lu)",
          (unsigned long)count, (unsigned long)sOrphanedPool.count);
}

+ (void)createAllLeaks {
    NSLog(@"[LeakExample] ========== Creating all leak examples ==========");
    [self createRetainCycle];
    [self createRetainCycle];
    [self createRetainCycle];
    [self createTimerLeak];
    [self createBlockCaptureLeak];
    [self createBlockCaptureLeak];
    [self accumulateOrphanedObjects:20];
    NSLog(@"[LeakExample] ========== All leak examples created ==========");
}

+ (NSUInteger)orphanedCount {
    return sOrphanedPool.count;
}

@end
