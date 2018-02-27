'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var path = _interopDefault(require('path'));
var fs = _interopDefault(require('fs-extra'));
var rollupPluginutils = require('rollup-pluginutils');
var postcss = _interopDefault(require('postcss'));
var styleInject = _interopDefault(require('style-inject'));
var Concat = _interopDefault(require('concat-with-sourcemaps'));
var reserved = _interopDefault(require('reserved-words'));
var chalk = _interopDefault(require('chalk'));

function escapeClassNameDashes(str) {
  return str.replace(/-+/g, match => {
    return `$${match.replace(/-/g, '_')}$`;
  });
}

function cwd(file) {
  return path.join(process.cwd(), file);
}

function extractCssAndWriteToFile(source, sourceMap, dest, manualDest) {
  const promises = [];

  let css = source.content.toString();

  if (sourceMap) {
    let map = source.sourceMap;

    if (!manualDest) {
      map = JSON.parse(map);
      map.file = fileName;
      map = JSON.stringify(map);
    }

    if (sourceMap === 'inline') {
      map = Buffer.from(map).toString('base64');
      css += `\n/*# sourceMappingURL=data:application/json;base64,${map}*/`;
    } else {
      css += `\n/*# sourceMappingURL=${fileName}.map */`;
      promises.push(fs.outputFile(`${dest}.map`, map));
    }
  }

  promises.push(fs.outputFile(dest, css));

  return Promise.all(promises);
}

const injectFnName = '__$styleInject';

function css(options = {}) {
  const filter = rollupPluginutils.createFilter(options.include, options.exclude);
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
          concat.add(file, transformedFiles[file].css, transformedFiles[file].map);
        });

        if (combineStyleTags) {
          return `${injectStyleFuncCode}\n${injectFnName}(${JSON.stringify(concat.content.toString())})`;
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

      return Promise.resolve().then(() => {
        if (options.preprocessor) {
          return options.preprocessor(code, id);
        }

        return { code };
      }).then(input => {
        if (input.map && input.map.mappings) {
          opts.map.prev = input.map;
        }

        return postcss(options.plugins || []).process(input.code.replace(/\/\*[@#][\s\t]+sourceMappingURL=.*?\*\/$/gm, ''), opts).then(result => {
          let codeExportDefault;
          let codeExportSparse = '';

          if (getExport) {
            codeExportDefault = getExport(result.opts.from);

            if (getExportNamed) {
              Object.keys(codeExportDefault).forEach(key => {
                let newKey = escapeClassNameDashes(key);

                if (reserved.check(key)) {
                  newKey = `$${key}$`;
                  codeExportSparse += `export const ${newKey}=${JSON.stringify(codeExportDefault[key])};\n`;
                }

                if (newKey !== key) {
                  console.warn(chalk.yellow('use'), chalk.cyan(`${newKey}`), chalk.yellow('to import'), chalk.cyan(`${key}`), chalk.yellow('className'));

                  codeExportDefault[newKey] = codeExportDefault[key];
                }
              });
            }
          }

          if (combineStyleTags || extract) {
            transformedFiles[result.opts.from] = {
              css: result.css,
              map: result.map && result.map.toString()
            };

            return {
              code: `${codeExportSparse}export default ${JSON.stringify(codeExportDefault)};`,
              map: { mappings: '' }
            };
          }

          return {
            code: `${codeExportSparse}export default ${injectFnName}(${JSON.stringify(result.css)},${JSON.stringify(codeExportDefault)});`,
            map: options.sourceMap && result.map ? JSON.parse(result.map) : { mappings: '' }
          };
        });
      });
    },
    ongenerate(opts) {
      if (extract) {
        const dest = extractPath ? extractPath : opts.file;
        const filename = path.basename(dest, path.extname(dest)) + '.css';
        const cssOutputDest = path.join(path.dirname(dest), filename);

        return extractCssAndWriteToFile(concat, options.sourceMap, cssOutputDest, extractPath).then(function () {
          options.onwrite && options.onwrite(cssOutputDest);
        }).catch(function (error) {
          throw error;
        });
      }
    }
  };
}

module.exports = css;
