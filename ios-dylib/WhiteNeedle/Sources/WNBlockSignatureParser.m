#import "WNBlockSignatureParser.h"
#import <CoreGraphics/CoreGraphics.h>

static NSString *const kDomain = @"WNBlockSignatureParser";

static void skipWS(NSScanner *sc) {
    NSCharacterSet *ws = [NSCharacterSet whitespaceAndNewlineCharacterSet];
    while (!sc.isAtEnd && [ws characterIsMember:[sc.string characterAtIndex:sc.scanLocation]]) {
        sc.scanLocation++;
    }
}

static BOOL scanWord(NSScanner *sc, NSString *word) {
    if (sc.isAtEnd) return NO;
    NSUInteger pos = sc.scanLocation;
    if (![sc scanString:word intoString:NULL]) {
        return NO;
    }
    if (sc.isAtEnd) return YES;
    unichar c = [sc.string characterAtIndex:sc.scanLocation];
    if ([[NSCharacterSet alphanumericCharacterSet] characterIsMember:c] || c == '_') {
        sc.scanLocation = pos;
        return NO;
    }
    return YES;
}

static BOOL scanOpenParen(NSScanner *sc) {
    skipWS(sc);
    return [sc scanString:@"(" intoString:NULL];
}

static BOOL scanCloseParen(NSScanner *sc) {
    skipWS(sc);
    return [sc scanString:@")" intoString:NULL];
}

static BOOL scanCaretSection(NSScanner *sc) {
    skipWS(sc);
    if (![sc scanString:@"(" intoString:NULL]) return NO;
    skipWS(sc);
    if (![sc scanString:@"^" intoString:NULL]) return NO;
    skipWS(sc);
    return [sc scanString:@")" intoString:NULL];
}

@implementation WNBlockSignatureParser

+ (NSDictionary<NSString *, NSString *> *)keywordEncodings {
    static NSDictionary *map;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        map = @{
            @"void" : @"v",
            @"id" : @"@",
            @"BOOL" : @"B",
            @"bool" : @"B",
            @"Class" : @"#",
            @"SEL" : @":",
            @"int" : @"i",
            @"float" : @"f",
            @"double" : @"d",
            @"char" : @"c",
            @"short" : @"s",
            @"CGFloat" : [NSString stringWithUTF8String:@encode(CGFloat)],
            @"NSInteger" : [NSString stringWithUTF8String:@encode(NSInteger)],
            @"NSUInteger" : [NSString stringWithUTF8String:@encode(NSUInteger)],
            @"long" : [NSString stringWithUTF8String:@encode(long)],
            @"unsigned int" : @"I",
            @"unsigned short" : @"S",
            @"unsigned char" : @"C",
            @"unsigned long" : [NSString stringWithUTF8String:@encode(unsigned long)],
            @"unsigned long long" : @"Q",
            @"long long" : @"q",
            @"CGRect" : [NSString stringWithUTF8String:@encode(CGRect)],
            @"CGPoint" : [NSString stringWithUTF8String:@encode(CGPoint)],
            @"CGSize" : [NSString stringWithUTF8String:@encode(CGSize)],
        };
    });
    return map;
}

+ (NSArray<NSString *> *)keywordPhrases {
    static NSArray *phrases;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        phrases = @[
            @"unsigned long long",
            @"unsigned long",
            @"long long",
            @"unsigned int",
            @"unsigned short",
            @"unsigned char",
            @"NSInteger",
            @"NSUInteger",
            @"CGFloat",
            @"CGRect",
            @"CGPoint",
            @"CGSize",
            @"Class",
            @"BOOL",
            @"SEL",
            @"double",
            @"float",
            @"short",
            @"long",
            @"char",
            @"int",
            @"void",
            @"id",
            @"bool",
        ];
    });
    return phrases;
}

+ (BOOL)scanKeywordEncoding:(NSScanner *)sc into:(NSString *__autoreleasing *)outEnc error:(NSError **)error {
    skipWS(sc);
    if (sc.isAtEnd) return NO;

    NSDictionary *dict = [self keywordEncodings];
    for (NSString *phrase in [self keywordPhrases]) {
        NSUInteger pos = sc.scanLocation;
        if (scanWord(sc, phrase)) {
            NSString *enc = dict[phrase];
            if (enc.length > 0) {
                *outEnc = enc;
                return YES;
            }
        }
        sc.scanLocation = pos;
    }

    if (error) {
        NSUInteger loc = MIN(sc.scanLocation, sc.string.length > 0 ? sc.string.length - 1 : 0);
        NSString *tail = loc < sc.string.length ? [sc.string substringFromIndex:loc] : @"";
        *error = [NSError errorWithDomain:kDomain
                                     code:1
                                 userInfo:@{
                                     NSLocalizedDescriptionKey :
                                         [NSString stringWithFormat:@"Unknown type at location %lu: %@", (unsigned long)sc.scanLocation, tail]
                                 }];
    }
    return NO;
}

+ (BOOL)scanReturnEncoding:(NSScanner *)sc into:(NSString *__autoreleasing *)outEnc error:(NSError **)error {
    return [self scanKeywordEncoding:sc into:outEnc error:error];
}

+ (BOOL)scanBlockParameterEncoding:(NSScanner *)sc into:(NSString *__autoreleasing *)outEnc error:(NSError **)error {
    NSString *retPart = nil;
    if (![self scanReturnEncoding:sc into:&retPart error:error]) return NO;
    if ([retPart hasPrefix:@"{"]) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:4
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Nested block cannot return struct" }];
        }
        return NO;
    }
    if (!scanCaretSection(sc)) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:2
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected (^) after nested block return type" }];
        }
        return NO;
    }
    if (!scanOpenParen(sc)) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:3
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected '(' before nested parameters" }];
        }
        return NO;
    }
    skipWS(sc);
    if ([sc scanString:@")" intoString:NULL]) {
        *outEnc = @"@?";
        return YES;
    }

    while (YES) {
        NSError *err = nil;
        NSString *arg = nil;
        if (![self scanParameterEncoding:sc into:&arg error:&err]) {
            if (error) *error = err;
            return NO;
        }
        (void)arg;
        skipWS(sc);
        if ([sc scanString:@")" intoString:NULL]) break;
        if ([sc scanString:@"," intoString:NULL]) continue;
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:5
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected ',' or ')' in nested parameters" }];
        }
        return NO;
    }

    *outEnc = @"@?";
    return YES;
}

+ (BOOL)scanParameterEncoding:(NSScanner *)sc into:(NSString *__autoreleasing *)outEnc error:(NSError **)error {
    skipWS(sc);
    if (sc.isAtEnd) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:6
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Unexpected end of signature" }];
        }
        return NO;
    }

    NSUInteger pos = sc.scanLocation;

    // Case 1: starts with '(' — could be (^returnType)(params) shorthand (not typical)
    if ([sc scanString:@"(" intoString:NULL]) {
        skipWS(sc);
        if ([sc scanString:@"^" intoString:NULL]) {
            sc.scanLocation = pos;
            return [self scanBlockParameterEncoding:sc into:outEnc error:error];
        }
    }
    sc.scanLocation = pos;

    // Case 2: starts with keyword — could be plain type OR nested block "type (^)(…)"
    NSString *keyEnc = nil;
    if ([self scanKeywordEncoding:sc into:&keyEnc error:nil]) {
        NSUInteger afterKeyword = sc.scanLocation;
        skipWS(sc);
        NSUInteger checkPos = sc.scanLocation;
        if (!sc.isAtEnd && [sc scanString:@"(" intoString:NULL]) {
            skipWS(sc);
            if ([sc scanString:@"^" intoString:NULL]) {
                // "keyword (^)(...)" pattern — reset and parse as nested block
                sc.scanLocation = pos;
                return [self scanBlockParameterEncoding:sc into:outEnc error:error];
            }
            sc.scanLocation = checkPos;
        } else {
            sc.scanLocation = afterKeyword;
        }
        *outEnc = keyEnc;
        return YES;
    }

    sc.scanLocation = pos;
    if (error) {
        NSUInteger loc = MIN(sc.scanLocation, sc.string.length > 0 ? sc.string.length - 1 : 0);
        NSString *tail = loc < sc.string.length ? [sc.string substringFromIndex:loc] : @"";
        *error = [NSError errorWithDomain:kDomain
                                     code:6
                                 userInfo:@{
                                     NSLocalizedDescriptionKey :
                                         [NSString stringWithFormat:@"Unknown parameter type at location %lu: %@", (unsigned long)sc.scanLocation, tail]
                                 }];
    }
    return NO;
}

+ (BOOL)parseSignature:(NSString *)source
              returnEnc:(NSString *__autoreleasing *)retEnc
                argEncs:(NSMutableArray<NSString *> *)argEncs
                  error:(NSError **)error {
    NSScanner *sc = [NSScanner scannerWithString:source];
    sc.charactersToBeSkipped = nil;

    NSString *retPart = nil;
    if (![self scanReturnEncoding:sc into:&retPart error:error]) return NO;

    if (!scanCaretSection(sc)) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:7
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected (^) after return type" }];
        }
        return NO;
    }
    if (!scanOpenParen(sc)) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:8
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected '(' before parameters" }];
        }
        return NO;
    }

    skipWS(sc);
    if ([sc scanString:@")" intoString:NULL]) {
        *retEnc = retPart;
        return YES;
    }

    NSUInteger voidPos = sc.scanLocation;
    if (scanWord(sc, @"void")) {
        skipWS(sc);
        if ([sc scanString:@")" intoString:NULL]) {
            *retEnc = retPart;
            return YES;
        }
        sc.scanLocation = voidPos;
    }

    while (YES) {
        NSString *arg = nil;
        if (![self scanParameterEncoding:sc into:&arg error:error]) return NO;
        [argEncs addObject:arg];
        skipWS(sc);
        if ([sc scanString:@")" intoString:NULL]) break;
        if ([sc scanString:@"," intoString:NULL]) continue;
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:9
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Expected ',' or ')' after parameter" }];
        }
        return NO;
    }

    skipWS(sc);
    if (!sc.isAtEnd) {
        if (error) {
            *error =
                [NSError errorWithDomain:kDomain
                                    code:10
                                userInfo:@{
                                    NSLocalizedDescriptionKey : [NSString stringWithFormat:@"Extra text after signature: %@",
                                                                                           [source substringFromIndex:sc.scanLocation]]
                                }];
        }
        return NO;
    }

    *retEnc = retPart;
    return YES;
}

+ (nullable NSString *)typeEncodingFromSignature:(NSString *)signature error:(NSError *__autoreleasing *)error {
    if (signature.length == 0) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:11
                                     userInfo:@{ NSLocalizedDescriptionKey : @"Empty signature" }];
        }
        return nil;
    }

    NSMutableString *norm = [NSMutableString string];
    NSCharacterSet *ws = [NSCharacterSet whitespaceAndNewlineCharacterSet];
    for (NSUInteger i = 0; i < signature.length; i++) {
        unichar c = [signature characterAtIndex:i];
        if ([ws characterIsMember:c]) {
            if (norm.length == 0 || [norm characterAtIndex:norm.length - 1] == ' ') continue;
            [norm appendString:@" "];
        } else {
            [norm appendFormat:@"%C", c];
        }
    }
    NSString *trimmed = [norm stringByTrimmingCharactersInSet:ws];

    NSMutableArray<NSString *> *args = [NSMutableArray array];
    NSString *ret = nil;
    NSError *err = nil;
    if (![self parseSignature:trimmed returnEnc:&ret argEncs:args error:&err]) {
        if (error) *error = err;
        return nil;
    }

    NSMutableString *out = [NSMutableString stringWithString:ret];
    [out appendString:@"@?"];
    for (NSString *a in args) {
        [out appendString:a];
    }

    NSString *final = [out copy];
    @try {
        [NSMethodSignature signatureWithObjCTypes:final.UTF8String];
    } @catch (NSException *ex) {
        if (error) {
            *error = [NSError errorWithDomain:kDomain
                                         code:12
                                     userInfo:@{
                                         NSLocalizedDescriptionKey :
                                             [NSString stringWithFormat:@"Invalid encoding '%@': %@", final, ex.reason ?: @""]
                                     }];
        }
        return nil;
    }

    return final;
}

@end
