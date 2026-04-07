#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNTypeConversion : NSObject

/**
 * Convert a JSValue to a native value suitable for passing via NSInvocation,
 * based on the ObjC type encoding character.
 */
+ (void)convertJSValue:(JSValue *)value
         toTypeEncoding:(const char *)typeEncoding
                 buffer:(void *)buffer
              inContext:(JSContext *)context;

/**
 * Convert a native value (pointed to by buffer) back to a JSValue,
 * based on the ObjC type encoding character.
 */
+ (JSValue *)convertToJSValue:(const void *)buffer
                 typeEncoding:(const char *)typeEncoding
                    inContext:(JSContext *)context;

/**
 * Convert NSInvocation argument at index to JSValue.
 */
+ (JSValue *)convertInvocationArgument:(NSInvocation *)invocation
                               atIndex:(NSInteger)index
                             inContext:(JSContext *)context;

/**
 * Set NSInvocation return value from JSValue.
 */
+ (void)setInvocationReturnValue:(NSInvocation *)invocation
                       fromJSValue:(JSValue *)value
                         inContext:(JSContext *)context;

/**
 * Parse an ObjC method signature type string into individual type encodings.
 */
+ (NSArray<NSString *> *)parseTypeEncodings:(NSMethodSignature *)signature;

/**
 * Convert an ObjC type encoding string to a human-readable type name.
 * e.g. @"NSString" → "NSString *", i → "int", {CGRect=...} → "CGRect"
 */
+ (NSString *)humanReadableType:(const char *)typeEncoding;

/**
 * Convert a full ObjC method type encoding string to a human-readable signature.
 * e.g. "v@:@i" → "(id, int) → void"
 */
+ (NSString *)humanReadableMethodSignature:(const char *)fullEncoding;

/**
 * Convert a JSValue to a native ObjC object (id), handling boxing.
 */
+ (nullable id)jsValueToObjCObject:(JSValue *)value;

/**
 * Convert an ObjC object (id) to a JSValue, handling boxing for complex types.
 */
+ (JSValue *)objcObjectToJSValue:(nullable id)obj inContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
