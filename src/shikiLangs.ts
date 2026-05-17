import type { LanguageRegistration } from '@shikijs/core';

// Static imports of only the languages VScope maps to (via ext-to-lang.json).
// Esbuild bundles exactly these — all other @shikijs/langs grammars are excluded,
// so shiki no longer ships as node_modules in the .vsix.
import lang_asciidoc from '@shikijs/langs/asciidoc';
import lang_asm from '@shikijs/langs/asm';
import lang_bat from '@shikijs/langs/bat';
import lang_bibtex from '@shikijs/langs/bibtex';
import lang_c from '@shikijs/langs/c';
import lang_cairo from '@shikijs/langs/cairo';
import lang_clojure from '@shikijs/langs/clojure';
import lang_cmake from '@shikijs/langs/cmake';
import lang_coffeescript from '@shikijs/langs/coffeescript';
import lang_cpp from '@shikijs/langs/cpp';
import lang_crystal from '@shikijs/langs/crystal';
import lang_csharp from '@shikijs/langs/csharp';
import lang_css from '@shikijs/langs/css';
import lang_d from '@shikijs/langs/d';
import lang_dart from '@shikijs/langs/dart';
import lang_diff from '@shikijs/langs/diff';
import lang_dockerfile from '@shikijs/langs/dockerfile';
import lang_dotenv from '@shikijs/langs/dotenv';
import lang_elixir from '@shikijs/langs/elixir';
import lang_elm from '@shikijs/langs/elm';
import lang_erb from '@shikijs/langs/erb';
import lang_fish from '@shikijs/langs/fish';
import lang_fsharp from '@shikijs/langs/fsharp';
import lang_gleam from '@shikijs/langs/gleam';
import lang_go from '@shikijs/langs/go';
import lang_graphql from '@shikijs/langs/graphql';
import lang_groovy from '@shikijs/langs/groovy';
import lang_haml from '@shikijs/langs/haml';
import lang_handlebars from '@shikijs/langs/handlebars';
import lang_haskell from '@shikijs/langs/haskell';
import lang_hcl from '@shikijs/langs/hcl';
import lang_html from '@shikijs/langs/html';
import lang_ini from '@shikijs/langs/ini';
import lang_jade from '@shikijs/langs/jade';
import lang_java from '@shikijs/langs/java';
import lang_javascript from '@shikijs/langs/javascript';
import lang_json from '@shikijs/langs/json';
import lang_json5 from '@shikijs/langs/json5';
import lang_jsonc from '@shikijs/langs/jsonc';
import lang_jsx from '@shikijs/langs/jsx';
import lang_julia from '@shikijs/langs/julia';
import lang_kotlin from '@shikijs/langs/kotlin';
import lang_latex from '@shikijs/langs/latex';
import lang_less from '@shikijs/langs/less';
import lang_log from '@shikijs/langs/log';
import lang_lua from '@shikijs/langs/lua';
import lang_makefile from '@shikijs/langs/makefile';
import lang_markdown from '@shikijs/langs/markdown';
import lang_mojo from '@shikijs/langs/mojo';
import lang_move from '@shikijs/langs/move';
import lang_nim from '@shikijs/langs/nim';
import lang_objective_c from '@shikijs/langs/objective-c';
import lang_objective_cpp from '@shikijs/langs/objective-cpp';
import lang_ocaml from '@shikijs/langs/ocaml';
import lang_odin from '@shikijs/langs/odin';
import lang_perl from '@shikijs/langs/perl';
import lang_php from '@shikijs/langs/php';
import lang_powershell from '@shikijs/langs/powershell';
import lang_properties from '@shikijs/langs/properties';
import lang_proto from '@shikijs/langs/proto';
import lang_pug from '@shikijs/langs/pug';
import lang_python from '@shikijs/langs/python';
import lang_r from '@shikijs/langs/r';
import lang_razor from '@shikijs/langs/razor';
import lang_rst from '@shikijs/langs/rst';
import lang_ruby from '@shikijs/langs/ruby';
import lang_rust from '@shikijs/langs/rust';
import lang_sass from '@shikijs/langs/sass';
import lang_scala from '@shikijs/langs/scala';
import lang_scss from '@shikijs/langs/scss';
import lang_shellscript from '@shikijs/langs/shellscript';
import lang_solidity from '@shikijs/langs/solidity';
import lang_sql from '@shikijs/langs/sql';
import lang_svelte from '@shikijs/langs/svelte';
import lang_swift from '@shikijs/langs/swift';
import lang_system_verilog from '@shikijs/langs/system-verilog';
import lang_terraform from '@shikijs/langs/terraform';
import lang_toml from '@shikijs/langs/toml';
import lang_tsx from '@shikijs/langs/tsx';
import lang_twig from '@shikijs/langs/twig';
import lang_typescript from '@shikijs/langs/typescript';
import lang_vb from '@shikijs/langs/vb';
import lang_verilog from '@shikijs/langs/verilog';
import lang_vhdl from '@shikijs/langs/vhdl';
import lang_viml from '@shikijs/langs/viml';
import lang_vue from '@shikijs/langs/vue';
import lang_xml from '@shikijs/langs/xml';
import lang_yaml from '@shikijs/langs/yaml';
import lang_zig from '@shikijs/langs/zig';

export const BUNDLED_LANGS: LanguageRegistration[][] = [
    lang_asciidoc,
    lang_asm,
    lang_bat,
    lang_bibtex,
    lang_c,
    lang_cairo,
    lang_clojure,
    lang_cmake,
    lang_coffeescript,
    lang_cpp,
    lang_crystal,
    lang_csharp,
    lang_css,
    lang_d,
    lang_dart,
    lang_diff,
    lang_dockerfile,
    lang_dotenv,
    lang_elixir,
    lang_elm,
    lang_erb,
    lang_fish,
    lang_fsharp,
    lang_gleam,
    lang_go,
    lang_graphql,
    lang_groovy,
    lang_haml,
    lang_handlebars,
    lang_haskell,
    lang_hcl,
    lang_html,
    lang_ini,
    lang_jade,
    lang_java,
    lang_javascript,
    lang_json,
    lang_json5,
    lang_jsonc,
    lang_jsx,
    lang_julia,
    lang_kotlin,
    lang_latex,
    lang_less,
    lang_log,
    lang_lua,
    lang_makefile,
    lang_markdown,
    lang_mojo,
    lang_move,
    lang_nim,
    lang_objective_c,
    lang_objective_cpp,
    lang_ocaml,
    lang_odin,
    lang_perl,
    lang_php,
    lang_powershell,
    lang_properties,
    lang_proto,
    lang_pug,
    lang_python,
    lang_r,
    lang_razor,
    lang_rst,
    lang_ruby,
    lang_rust,
    lang_sass,
    lang_scala,
    lang_scss,
    lang_shellscript,
    lang_solidity,
    lang_sql,
    lang_svelte,
    lang_swift,
    lang_system_verilog,
    lang_terraform,
    lang_toml,
    lang_tsx,
    lang_twig,
    lang_typescript,
    lang_vb,
    lang_verilog,
    lang_vhdl,
    lang_viml,
    lang_vue,
    lang_xml,
    lang_yaml,
    lang_zig,
];

export const BUNDLED_LANG_SET = new Set<string>(
    BUNDLED_LANGS.flat().flatMap(l => [l.name, ...(l.aliases ?? [])])
);
