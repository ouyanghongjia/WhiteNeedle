#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Parses ObjC-style block signatures (e.g. void (^)(id, double)) into
 * WhiteNeedle simplified type encodings (e.g. v@?@d).
 *
 * Supported: void, id, BOOL/bool, integer family, float/double/CGFloat, Class, SEL,
 * CGRect/CGPoint/CGSize, nested blocks (encoded as @? per parameter).
 */
@interface WNBlockSignatureParser : NSObject

/**
 * Canonical mapping of ObjC type names to type encoding characters.
 * e.g. @"void"→@"v", @"int"→@"i", @"CGRect"→@"{CGRect=...}"
 * Shared as single source of truth for both forward and reverse lookups.
 */
+ (NSDictionary<NSString *, NSString *> *)keywordEncodings;

+ (nullable NSString *)typeEncodingFromSignature:(NSString *)signature
                                           error:(NSError *__nullable *__nullable)error;

@end

NS_ASSUME_NONNULL_END
