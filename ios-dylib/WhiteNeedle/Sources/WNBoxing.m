#import "WNBoxing.h"

@interface WNBoxing ()
@property (nonatomic, weak) id weakBoxedValue;
@property (nonatomic, assign) BOOL isWeak;
@end

@implementation WNBoxing

+ (instancetype)boxObject:(id)obj {
    WNBoxing *box = [[WNBoxing alloc] init];
    box.boxedValue = obj;
    box.isPointer = NO;
    box.isWeak = NO;
    return box;
}

+ (instancetype)boxPointer:(void *)ptr {
    WNBoxing *box = [[WNBoxing alloc] init];
    box.pointerValue = ptr;
    box.isPointer = YES;
    box.isWeak = NO;
    return box;
}

+ (instancetype)boxWeakObject:(id)obj {
    WNBoxing *box = [[WNBoxing alloc] init];
    box.weakBoxedValue = obj;
    box.isPointer = NO;
    box.isWeak = YES;
    return box;
}

- (id)unbox {
    if (self.isWeak) return self.weakBoxedValue;
    return self.boxedValue;
}

- (void *)unboxPointer {
    return self.pointerValue;
}

- (NSString *)description {
    if (self.isPointer) {
        return [NSString stringWithFormat:@"<WNBoxing: ptr=%p>", self.pointerValue];
    }
    id val = [self unbox];
    return [NSString stringWithFormat:@"<WNBoxing: %@>", val ?: @"nil"];
}

@end

@implementation WNBlockBox

+ (instancetype)boxBlock:(JSValue *)fn signature:(NSMethodSignature *)sig {
    WNBlockBox *box = [[WNBlockBox alloc] init];
    box.jsFunction = fn;
    box.signature = sig;
    return box;
}

@end
