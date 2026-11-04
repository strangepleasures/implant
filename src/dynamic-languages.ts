// Registers the bundled tree-sitter grammars with ast-grep as a side effect of import.
import * as astGrep from '@ast-grep/napi';
import * as astGrepPython from '@ast-grep/lang-python';
import * as astGrepGo from '@ast-grep/lang-go';
import * as astGrepRust from '@ast-grep/lang-rust';
import * as astGrepJava from '@ast-grep/lang-java';
import * as astGrepC from '@ast-grep/lang-c';
import * as astGrepCpp from '@ast-grep/lang-cpp';

// The `@ast-grep/napi` binding ships only 5 built-in languages (Html, JavaScript, Tsx,
// Css, TypeScript). We augment that at module load with the dynamic-language packages
// we bundle so `astGrep.parse("Python", src)` etc. work from any snippet.
// `registerDynamicLanguage` may only be called once per process, so this MUST happen
// exactly here — before any snippet gets a chance to call it itself.
//
// Wrapped in try/catch: the tree-sitter grammar packages don't ship prebuilds for every
// platform ast-grep itself supports (in particular, they lack Linux musl and Windows
// arm64 binaries). On those platforms `libraryPath` throws when loaded; skipping the
// extra languages there is preferable to failing extension activation.
try {
	astGrep.registerDynamicLanguage({
		Python: astGrepPython,
		Go: astGrepGo,
		Rust: astGrepRust,
		Java: astGrepJava,
		C: astGrepC,
		Cpp: astGrepCpp,
	});
} catch (err) {
	console.warn('Implant: dynamic language registration failed — Python/Go/Rust/Java/C/C++ ast-grep support unavailable on this platform:', (err as Error).message);
}
