// WNObjCProxy: Wraps an ObjC class or instance for JS access
#import <Foundation/Foundation.h>

@interface WNObjCProxy : NSObject
@property (nonatomic, strong, nullable) id target;
@property (nonatomic, assign, nullable) Class targetClass;
@property (nonatomic, assign) BOOL isClassProxy;
@end