#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString *const kWNServiceType;

@interface WNBonjourAdvertiser : NSObject

@property (nonatomic, readonly) BOOL isPublishing;

- (void)startWithPort:(NSInteger)port;
- (void)stop;

@end

NS_ASSUME_NONNULL_END
