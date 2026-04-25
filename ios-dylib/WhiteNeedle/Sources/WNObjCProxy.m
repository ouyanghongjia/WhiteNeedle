#import "WNObjCProxy.h"

@implementation WNObjCProxy
- (NSString *)description {
    if (self.isClassProxy) {
        return [NSString stringWithFormat:@"<WNObjCProxy: Class %@>", NSStringFromClass(self.targetClass)];
    }
    return [NSString stringWithFormat:@"<WNObjCProxy: %@>", self.target];
}
@end