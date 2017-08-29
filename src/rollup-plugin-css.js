import path from 'path';
import fs from 'fs-extra';
import { createFilter } from 'rollup-pluginutils';
import postcss from 'postcss';
import styleInject from 'style-inject';
import Concat from 'concat-with-sourcemaps';
import reserved from 'reserved-words';
import chalk from 'chalk';

function escapeClassNameDashes(str) {
  return str.replace(/-+/g, match => {
    return `$${ match.replace(/-/g, '_') }$`;
  });
}

function cwd(file) {
  return path.join(process.cwd(), file);
}

function extractCssAndWriteToFile(source, sourceMap, dest, manualDest) {
  const promises = [];
  const fileName = path.basename(dest, path.extname(dest)) + '.css';
  const cssOutputDest = path.join(path.dirname(dest), fileName);

  let css = source.content.toString('utf8');

  if (sourceMap) {
    let map = source.sourceMap;

    if (!manualDest) {
      map = JSON.parse(map);
      map.file = fileName;
      map = JSON.stringify(map);
    }

    if (sourceMap === 'inline') {
      map = Buffer.from(map, 'utf8').toString('base64');
      css += `\n/*# sourceMappingURL=data:application/json;base64,${ map }*/`;
    } else {
      css += `\n/*# sourceMappingURL=${ fileName }.map */`;
      promises.push(fs.outputFile(`${ cssOutputDest }.map`, map));
    }
  }

  promises.push(fs.outputFile(cssOutputDest, css));

  return Promise.all(promises);
}

const onwrite = Symbol('onwrite');
const injectFnName = '__$styleInject';

export default function css(options = {}) {
  const filter = createFilter(options.include, options.exclude);
  const extensions = options.extensions || ['.css'];
  const getExport = typeof options.getExport === 'function' ? options.getExport : false;
  const getExportNamed = options.getExportNamed || false;
  const combineStyleTags = Boolean(options.combineStyleTags);
  const extract = Boolean(options.extract);
  const extractPath = typeof options.extract === 'string' ? options.extract : null;

  let concat = null;

  const transformedFiles = {};
  const injectStyleFuncCode = styleInject.toString().replace(/styleInject/, injectFnName);

  return {
    intro() {
      if (extract || combineStyleTags) {
        concat = new Concat(true, path.basename(extractPath || 'styles.css'), '\n');

        Object.keys(transformedFiles).forEach(file => {
          concat.add(
            file,
            transformedFiles[file].css,
            transformedFiles[file].map
          )
        });

        if (combineStyleTags) {
          return `${ injectStyleFuncCode }\n${ injectFnName }(${ JSON.stringify(concat.content.toString('utf8')) })`;
        }
      } else {
        return injectStyleFuncCode;
      }
    },
    transform(code, id) {
      if (!filter(id)) {
        return null;
      }

      if (extensions.indexOf(path.extname(id)) === -1) {
        return null;
      }

      const opts = {
        from: options.from ? cwd(options.from) : id,
        to: options.to ? cwd(options.to) : id,
        map: {
          inline: false,
          annotation: false
        },
        parser: options.parser
      };

      return Promise
        .resolve()
        .then(() => {
          if (options.preprocessor) {
            return options.preprocessor(code, id);
          }

          return { code };
        })
        .then(input => {
          if (input.map && input.map.mappings) {
            opts.map.prev = input.map;
          }

          return postcss(options.plugins || [])
            .process(
              input.code.replace(
                /\/\*[@#][\s\t]+sourceMappingURL=.*?\*\/$/gm,
                ''
              ),
              opts
            )
            .then(result => {
              let codeExportDefault;
              let codeExportSparse = '';

              if (getExport) {
                codeExportDefault = getExport(result.opts.from);

                if (getExportNamed) {
                  Object.keys(codeExportDefault).forEach(key => {
                    let newKey = escapeClassNameDashes(key);

                    if (reserved.check(key)) {
                      newKey = `$${ key }$`;
                      codeExportSparse += `export const ${ newKey }=${ JSON.stringify(codeExportDefault[key]) };\n`;
                    }

                    if (newKey !== key) {
                      console.warn(
                        chalk.yellow('use'),
                        chalk.cyan(`${newKey}`),
                        chalk.yellow('to import'),
                        chalk.cyan(`${key}`),
                        chalk.yellow('className')
                      );

                      codeExportDefault[newKey] = codeExportDefault[key];
                    }
                  })
                }
              }

              if (combineStyleTags || extract) {
                transformedFiles[result.opts.from] = {
                  css: result.css,
                  map: result.map && result.map.toString()
                };

                return {
                  code: `${ codeExportSparse }export default ${ JSON.stringify(codeExportDefault) };`,
                  map: { mappings: '' }
                }
              }

              return {
                code: `${ codeExportSparse }export default ${ injectFnName }(${ JSON.stringify(result.css) },${ JSON.stringify(codeExportDefault) });`,
                map: options.sourceMap && result.map ? JSON.parse(result.map) : { mappings: '' }
              }
            })
        })
    },
    ongenerate(opts, result) {
      if (extract) {
        return result[onwrite] = extractCssAndWriteToFile(
          concat,
          options.sourceMap,
          extractPath ? extractPath : opts.file,
          extractPath
        );
      }
    }
  }
}

css.onwrite = onwrite;
