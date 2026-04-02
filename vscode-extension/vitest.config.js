"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        testTimeout: 10000,
    },
});
//# sourceMappingURL=vitest.config.js.map