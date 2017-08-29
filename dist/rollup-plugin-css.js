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
  return str.replace(/-+/g, function (match) {
    return '$' + match.replace(/-/g, '_') + '$';
  });
}

function cwd(file) {
  return path.join(process.cwd(), file);
}

function extractCssAndWriteToFile(source, sourceMap, dest, manualDest) {
  return Promise.resolve().then(function () {
    if (manualDest) {
      return fs.ensureDir(path.dirname(dest));
    }
  }).then(function () {
    var promises = [];
    var fileName = path.basename(dest, path.extname(dest)) + '.css';
    var cssOutputDest = path.join(path.dirname(dest), fileName);

    var css = source.content.toString('utf8');

    if (sourceMap) {
      var map = source.sourceMap;

      if (!manualDest) {
        map = JSON.parse(map);
        map.file = fileName;
        map = JSON.stringify(map);
      }

      if (sourceMap === 'inline') {
        css += '\n/*# sourceMappingURL=data:application/json;base64,' + Buffer.from(map, 'utf8').toString('base64') + '*/';
      } else {
        css += '\n/*# sourceMappingURL=' + fileName + '.map */';
        promises.push(fs.writeFile(cssOutputDest + '.map', map));
      }
    }

    promises.push(fs.writeFile(cssOutputDest, css));

    return Promise.all(promises);
  });
}

var rollupPluginCss = function () {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  var filter = rollupPluginutils.createFilter(options.include, options.exclude);
  var injectFnName = '__$styleInject';
  var extensions = options.extensions || ['.css', '.sss'];
  var getExport = typeof options.getExport === 'function' ? options.getExport : false;
  var getExportNamed = options.getExportNamed || false;
  var combineStyleTags = Boolean(options.combineStyleTags);
  var extract = Boolean(options.extract);
  var extractPath = typeof options.extract === 'string' ? options.extract : null;

  var concat = null;

  var transformedFiles = {};
  var injectStyleFuncCode = styleInject.toString().replace(/styleInject/, injectFnName);

  return {
    intro: function intro() {
      if (extract || combineStyleTags) {
        concat = new Concat(true, path.basename(extractPath || 'styles.css'), '\n');

        Object.keys(transformedFiles).forEach(function (file) {
          concat.add(file, transformedFiles[file].css, transformedFiles[file].map);
        });

        if (combineStyleTags) {
          return injectStyleFuncCode + '\n' + injectFnName + '(' + JSON.stringify(concat.content.toString('utf8')) + ')';
        }
      } else {
        return injectStyleFuncCode;
      }
    },
    transform: function transform(code, id) {
      if (!filter(id)) {
        return null;
      }

      if (extensions.indexOf(path.extname(id)) === -1) {
        return null;
      }

      var opts = {
        from: options.from ? cwd(options.from) : id,
        to: options.to ? cwd(options.to) : id,
        map: {
          inline: false,
          annotation: false
        },
        parser: options.parser
      };

      return Promise.resolve().then(function () {
        if (options.preprocessor) {
          return options.preprocessor(code, id);
        }

        return { code: code };
      }).then(function (input) {
        if (input.map && input.map.mappings) {
          opts.map.prev = input.map;
        }

        return postcss(options.plugins || []).process(input.code.replace(/\/\*[@#][\s\t]+sourceMappingURL=.*?\*\/$/gm, ''), opts).then(function (result) {
          var codeExportDefault = void 0;
          var codeExportSparse = '';

          if (getExport) {
            codeExportDefault = getExport(result.opts.from);

            if (getExportNamed) {
              Object.keys(codeExportDefault).forEach(function (key) {
                var newKey = escapeClassNameDashes(key);

                if (reserved.check(key)) {
                  newKey = '$' + key + '$';
                  codeExportSparse += 'export const ' + newKey + '=' + JSON.stringify(codeExportDefault[key]) + ';\n';
                }

                if (newKey !== key) {
                  console.warn(chalk.yellow('use'), chalk.cyan('' + newKey), chalk.yellow('to import'), chalk.cyan('' + key), chalk.yellow('className'));

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
              code: codeExportSparse + 'export default ' + JSON.stringify(codeExportDefault) + ';',
              map: { mappings: '' }
            };
          }

          return {
            code: codeExportSparse + 'export default ' + injectFnName + '(' + JSON.stringify(result.css) + ',' + JSON.stringify(codeExportDefault) + ');',
            map: options.sourceMap && result.map ? JSON.parse(result.map) : { mappings: '' }
          };
        });
      });
    },
    ongenerate: function ongenerate(opts) {
      if (extract) {
        return extractCssAndWriteToFile(concat, options.sourceMap, extractPath ? extractPath : opts.file, extractPath);
      }
    }
  };
};

module.exports = rollupPluginCss;