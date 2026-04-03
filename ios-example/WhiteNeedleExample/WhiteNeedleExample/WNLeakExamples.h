#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#pragma mark - Leak Pattern 1: Retain Cycle (A ↔ B)

@class WNRetainCycleB;

@interface WNRetainCycleA : NSObject
@property (nonatomic, strong) WNRetainCycleB *partnerB;
@property (nonatomic, copy)   NSString *label;
@end

@interface WNRetainCycleB : NSObject
@property (nonatomic, strong) WNRetainCycleA *partnerA;
@property (nonatomic, copy)   NSString *label;
@end

#pragma mark - Leak Pattern 2: Timer retaining target

@interface WNTimerLeaker : NSObject
@property (nonatomic, strong) NSTimer *timer;
@property (nonatomic, strong) NSMutableArray *data;
+ (instancetype)startLeaking;
@end

#pragma mark - Leak Pattern 3: Block capturing self

@interface WNBlockCaptureLeak : NSObject
@property (nonatomic, copy) void (^callback)(void);
@property (nonatomic, copy) NSString *name;
+ (instancetype)createLeaky;
@end

#pragma mark - Leak Pattern 4: Growing collection (never cleaned)

@interface WNOrphanedObject : NSObject
@property (nonatomic, strong) NSData *payload;
@property (nonatomic, assign) NSUInteger sequence;
@end

#pragma mark - Factory

@interface WNLeakExamples : NSObject

+ (void)createRetainCycle;
+ (void)createTimerLeak;
+ (void)createBlockCaptureLeak;
+ (void)accumulateOrphanedObjects:(NSUInteger)count;
+ (void)createAllLeaks;
+ (NSUInteger)orphanedCount;

@end

NS_ASSUME_NONNULL_END
