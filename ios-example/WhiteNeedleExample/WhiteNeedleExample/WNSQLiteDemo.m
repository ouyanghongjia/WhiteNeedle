#import "WNSQLiteDemo.h"
#import <sqlite3.h>

static NSString *const kDBName = @"demo.db";

@implementation WNSQLiteDemo

+ (NSString *)databasePath {
    NSString *appSupport = [NSSearchPathForDirectoriesInDomains(
        NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
    [[NSFileManager defaultManager] createDirectoryAtPath:appSupport
                              withIntermediateDirectories:YES attributes:nil error:nil];
    return [appSupport stringByAppendingPathComponent:kDBName];
}

+ (NSString *)createDemoDatabase {
    NSString *path = [self databasePath];

    // 删除旧库，确保每次都是干净的 demo 数据
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];

    sqlite3 *db = NULL;
    if (sqlite3_open(path.UTF8String, &db) != SQLITE_OK) {
        return [NSString stringWithFormat:@"ERROR: cannot open %@", path];
    }

    [self createTables:db];
    [self insertUsers:db];
    [self insertProducts:db];
    [self insertOrders:db];
    [self insertEvents:db];

    sqlite3_close(db);
    return path;
}

#pragma mark - Schema

+ (void)createTables:(sqlite3 *)db {
    const char *sqls[] = {
        "CREATE TABLE users ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  email TEXT UNIQUE NOT NULL,"
        "  age INTEGER,"
        "  level TEXT DEFAULT 'free',"
        "  created_at TEXT DEFAULT (datetime('now','localtime'))"
        ");",

        "CREATE TABLE products ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  price REAL NOT NULL,"
        "  stock INTEGER DEFAULT 0,"
        "  category TEXT,"
        "  created_at TEXT DEFAULT (datetime('now','localtime'))"
        ");",

        "CREATE TABLE orders ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  user_id INTEGER REFERENCES users(id),"
        "  product_id INTEGER REFERENCES products(id),"
        "  quantity INTEGER DEFAULT 1,"
        "  total_price REAL,"
        "  status TEXT DEFAULT 'pending',"
        "  created_at TEXT DEFAULT (datetime('now','localtime'))"
        ");",

        "CREATE TABLE events ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  type TEXT NOT NULL,"
        "  user_id INTEGER,"
        "  payload TEXT,"
        "  created_at TEXT DEFAULT (datetime('now','localtime'))"
        ");",

        "CREATE INDEX idx_orders_user ON orders(user_id);",
        "CREATE INDEX idx_orders_status ON orders(status);",
        "CREATE INDEX idx_events_type ON events(type);",
        "CREATE INDEX idx_events_user ON events(user_id);",
    };

    for (int i = 0; i < sizeof(sqls) / sizeof(sqls[0]); i++) {
        sqlite3_exec(db, sqls[i], NULL, NULL, NULL);
    }
}

#pragma mark - Seed Data

+ (void)insertUsers:(sqlite3 *)db {
    NSArray *users = @[
        @[@"Alice Chen",    @"alice@example.com",   @28, @"pro"],
        @[@"Bob Wang",      @"bob@example.com",     @35, @"free"],
        @[@"Carol Zhang",   @"carol@example.com",   @22, @"premium"],
        @[@"David Li",      @"david@example.com",   @41, @"pro"],
        @[@"Eve Liu",       @"eve@example.com",     @30, @"free"],
        @[@"Frank Zhao",    @"frank@example.com",   @26, @"free"],
        @[@"Grace Wu",      @"grace@example.com",   @33, @"premium"],
        @[@"Henry Sun",     @"henry@example.com",   @29, @"pro"],
    ];

    sqlite3_stmt *stmt = NULL;
    sqlite3_prepare_v2(db,
        "INSERT INTO users (name, email, age, level) VALUES (?, ?, ?, ?);",
        -1, &stmt, NULL);

    for (NSArray *u in users) {
        sqlite3_bind_text(stmt, 1, [u[0] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, [u[1] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 3, [u[2] intValue]);
        sqlite3_bind_text(stmt, 4, [u[3] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_reset(stmt);
    }
    sqlite3_finalize(stmt);
}

+ (void)insertProducts:(sqlite3 *)db {
    NSArray *products = @[
        @[@"iPhone 16 Pro",       @7999.0,  @120,  @"electronics"],
        @[@"AirPods Pro 3",       @1899.0,  @350,  @"electronics"],
        @[@"MacBook Air M4",      @8999.0,  @80,   @"electronics"],
        @[@"iPad mini 7",         @3499.0,  @200,  @"electronics"],
        @[@"Apple Watch Ultra 3", @5999.0,  @60,   @"wearable"],
        @[@"Magic Keyboard",      @999.0,   @500,  @"accessory"],
        @[@"USB-C Cable (2m)",    @149.0,   @2000, @"accessory"],
        @[@"AirTag 4-Pack",       @749.0,   @800,  @"accessory"],
        @[@"Studio Display",      @11499.0, @30,   @"electronics"],
        @[@"HomePod mini",        @749.0,   @400,  @"smart_home"],
    ];

    sqlite3_stmt *stmt = NULL;
    sqlite3_prepare_v2(db,
        "INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?);",
        -1, &stmt, NULL);

    for (NSArray *p in products) {
        sqlite3_bind_text(stmt, 1, [p[0] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_bind_double(stmt, 2, [p[1] doubleValue]);
        sqlite3_bind_int(stmt, 3, [p[2] intValue]);
        sqlite3_bind_text(stmt, 4, [p[3] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_reset(stmt);
    }
    sqlite3_finalize(stmt);
}

+ (void)insertOrders:(sqlite3 *)db {
    NSArray *orders = @[
        @[@1, @1, @1, @7999.0,  @"completed"],
        @[@1, @6, @2, @1998.0,  @"completed"],
        @[@2, @2, @1, @1899.0,  @"shipped"],
        @[@3, @3, @1, @8999.0,  @"pending"],
        @[@3, @7, @3, @447.0,   @"completed"],
        @[@4, @5, @1, @5999.0,  @"pending"],
        @[@5, @10, @2, @1498.0, @"shipped"],
        @[@6, @4, @1, @3499.0,  @"cancelled"],
        @[@7, @9, @1, @11499.0, @"completed"],
        @[@8, @8, @2, @1498.0,  @"pending"],
    ];

    sqlite3_stmt *stmt = NULL;
    sqlite3_prepare_v2(db,
        "INSERT INTO orders (user_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?);",
        -1, &stmt, NULL);

    for (NSArray *o in orders) {
        sqlite3_bind_int(stmt, 1, [o[0] intValue]);
        sqlite3_bind_int(stmt, 2, [o[1] intValue]);
        sqlite3_bind_int(stmt, 3, [o[2] intValue]);
        sqlite3_bind_double(stmt, 4, [o[3] doubleValue]);
        sqlite3_bind_text(stmt, 5, [o[4] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_reset(stmt);
    }
    sqlite3_finalize(stmt);
}

+ (void)insertEvents:(sqlite3 *)db {
    NSArray *events = @[
        @[@"app_launch",    @1, @"{\"version\":\"2.1.0\",\"build\":\"428\"}"],
        @[@"page_view",     @1, @"{\"page\":\"home\",\"duration_ms\":1200}"],
        @[@"page_view",     @1, @"{\"page\":\"products\",\"duration_ms\":3400}"],
        @[@"add_to_cart",   @1, @"{\"product_id\":1,\"quantity\":1}"],
        @[@"purchase",      @1, @"{\"order_id\":1,\"amount\":7999}"],
        @[@"app_launch",    @2, @"{\"version\":\"2.1.0\",\"build\":\"428\"}"],
        @[@"page_view",     @2, @"{\"page\":\"home\",\"duration_ms\":800}"],
        @[@"search",        @2, @"{\"query\":\"airpods\",\"results\":3}"],
        @[@"add_to_cart",   @2, @"{\"product_id\":2,\"quantity\":1}"],
        @[@"app_launch",    @3, @"{\"version\":\"2.0.9\",\"build\":\"415\"}"],
        @[@"page_view",     @3, @"{\"page\":\"deals\",\"duration_ms\":5200}"],
        @[@"purchase",      @3, @"{\"order_id\":5,\"amount\":447}"],
        @[@"app_background",@3, @"{\"session_duration_s\":120}"],
        @[@"push_received", @4, @"{\"campaign\":\"summer_sale\",\"clicked\":true}"],
        @[@"app_launch",    @5, @"{\"version\":\"2.1.0\",\"build\":\"428\"}"],
    ];

    sqlite3_stmt *stmt = NULL;
    sqlite3_prepare_v2(db,
        "INSERT INTO events (type, user_id, payload) VALUES (?, ?, ?);",
        -1, &stmt, NULL);

    for (NSArray *e in events) {
        sqlite3_bind_text(stmt, 1, [e[0] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 2, [e[1] intValue]);
        sqlite3_bind_text(stmt, 3, [e[2] UTF8String], -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_reset(stmt);
    }
    sqlite3_finalize(stmt);
}

#pragma mark - Simulate Activity

+ (NSString *)simulateUserActivity {
    NSString *path = [self databasePath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        return @"ERROR: demo.db does not exist. Call createDemoDatabase first.";
    }

    sqlite3 *db = NULL;
    if (sqlite3_open(path.UTF8String, &db) != SQLITE_OK) {
        return @"ERROR: cannot open demo.db";
    }

    static int activityCounter = 0;
    activityCounter++;

    int userId = (activityCounter % 8) + 1;
    int productId = (activityCounter % 10) + 1;
    int quantity = (activityCounter % 3) + 1;

    NSMutableString *summary = [NSMutableString string];

    // 新增一笔订单
    NSString *orderSQL = [NSString stringWithFormat:
        @"INSERT INTO orders (user_id, product_id, quantity, total_price, status) "
        "SELECT %d, %d, %d, price * %d, 'pending' FROM products WHERE id = %d;",
        userId, productId, quantity, quantity, productId];
    sqlite3_exec(db, orderSQL.UTF8String, NULL, NULL, NULL);
    int orderId = (int)sqlite3_last_insert_rowid(db);
    [summary appendFormat:@"New order #%d (user=%d, product=%d, qty=%d)", orderId, userId, productId, quantity];

    // 新增事件
    NSArray *eventTypes = @[@"page_view", @"add_to_cart", @"search", @"purchase", @"share"];
    NSString *eventType = eventTypes[activityCounter % eventTypes.count];
    NSString *payload = [NSString stringWithFormat:
        @"{\"order_id\":%d,\"action\":\"%@\",\"counter\":%d}",
        orderId, eventType, activityCounter];
    NSString *eventSQL = [NSString stringWithFormat:
        @"INSERT INTO events (type, user_id, payload) VALUES ('%@', %d, '%@');",
        eventType, userId, payload];
    sqlite3_exec(db, eventSQL.UTF8String, NULL, NULL, NULL);
    [summary appendFormat:@"; Event '%@' for user %d", eventType, userId];

    // 偶数次时，再更新一笔旧订单状态
    if (activityCounter % 2 == 0) {
        NSString *updateSQL = [NSString stringWithFormat:
            @"UPDATE orders SET status = 'shipped' WHERE status = 'pending' AND id = "
            "(SELECT id FROM orders WHERE status = 'pending' ORDER BY id LIMIT 1);"];
        sqlite3_exec(db, updateSQL.UTF8String, NULL, NULL, NULL);
        int changes = sqlite3_changes(db);
        if (changes > 0) {
            [summary appendString:@"; Shipped 1 pending order"];
        }
    }

    sqlite3_close(db);
    return summary;
}

@end
