#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNSQLiteDemo : NSObject

/// 创建 demo.db 并填充示例数据（users/products/orders/events 四张表）
/// 数据库路径: Library/Application Support/demo.db
/// @return 数据库绝对路径
+ (NSString *)createDemoDatabase;

/// 模拟用户操作：插入新订单 + 新事件（用于演示 snapshot/diff/watch）
/// @return 本次插入的数据描述
+ (NSString *)simulateUserActivity;

/// 返回 demo.db 的绝对路径（不创建）
+ (NSString *)databasePath;

@end

NS_ASSUME_NONNULL_END
