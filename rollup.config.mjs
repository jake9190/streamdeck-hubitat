import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
	input: "src/plugin.ts",
	output: {
		file: "com.jake.hubitat.sdPlugin/bin/plugin.js",
		format: "cjs",
		sourcemap: true,
	},
	external: [
		/^node:/,
		"fs",
		"path",
		"os",
		"crypto",
		"events",
		"stream",
		"http",
		"https",
		"net",
		"tls",
		"url",
		"util",
		"zlib",
		"buffer",
	],
	plugins: [
		typescript(),
		resolve({ preferBuiltins: true }),
		commonjs(),
	],
};
