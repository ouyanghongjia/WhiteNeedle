#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNFileSystemBridge registers the FileSystem namespace into a JSContext.
 *
 * Paths are resolved under the app sandbox (NSHomeDirectory()): relative segments,
 * absolute paths already under the home directory, or "/Documents/..." style (leading slash).
 *
 * API:
 *   FileSystem.list(path?)          → directory listing with attributes
 *   FileSystem.read(path)           → read file as UTF-8 string
 *   FileSystem.readBytes(path)      → read file as base64 string
 *   FileSystem.write(path, content) → write UTF-8 string to file
 *   FileSystem.exists(path)         → check if path exists
 *   FileSystem.stat(path)           → file attributes (size, dates, type)
 *   FileSystem.remove(path)         → delete file or empty directory
 *   FileSystem.mkdir(path)          → create directory (with intermediates)
 *   FileSystem.move(from, to)       → move/rename file or directory
 *   FileSystem.copy(from, to)       → copy file or directory
 *   FileSystem.snapshot(paths, max) → recursive flat listing of multiple roots
 *   FileSystem.home                 → sandbox root path (getter)
 */
@interface WNFileSystemBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
