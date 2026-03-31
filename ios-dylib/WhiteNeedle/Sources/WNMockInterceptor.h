#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, WNMockMode) {
    WNMockModePureMock,
    WNMockModeRewriteResponse,
};

@interface WNMockRule : NSObject
@property (nonatomic, copy) NSString *ruleId;
@property (nonatomic, copy) NSString *urlPattern;
@property (nonatomic, copy, nullable) NSString *method;
@property (nonatomic, assign) WNMockMode mode;

@property (nonatomic, assign) NSInteger statusCode;
@property (nonatomic, copy, nullable) NSDictionary<NSString *, NSString *> *responseHeaders;
@property (nonatomic, copy, nullable) NSString *responseBody;

@property (nonatomic, assign) BOOL enabled;
@property (nonatomic, assign) NSTimeInterval delay;

- (NSDictionary *)toDictionary;
- (BOOL)matchesRequest:(NSURLRequest *)request;
+ (WNMockRule *)ruleFromDictionary:(NSDictionary *)dict;
@end

@interface WNMockInterceptor : NSObject

+ (instancetype)shared;

- (void)addRule:(WNMockRule *)rule;
- (void)removeRule:(NSString *)ruleId;
- (void)updateRule:(NSString *)ruleId withDict:(NSDictionary *)dict;
- (void)removeAllRules;
- (NSArray<NSDictionary *> *)allRules;
- (nullable WNMockRule *)matchingRuleForRequest:(NSURLRequest *)request;

- (void)install;
- (void)uninstall;

@property (nonatomic, readonly) BOOL installed;

@end

NS_ASSUME_NONNULL_END
