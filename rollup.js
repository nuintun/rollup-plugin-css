'use strict';

const fs = require('fs');
const rollup = require('rollup');
const babel = require('rollup-plugin-babel');

rollup
  .rollup({
    legacy: true,
    input: 'src/rollup-plugin-css.js',
    plugins: [
      babel({
        exclude: 'node_modules/**' // only transpile our source code
      })
    ],
    external: [
      'path',
      'chalk',
      'concat-with-sourcemaps',
      'fs-extra',
      'postcss',
      'reserved-words',
      'rollup-pluginutils',
      'style-inject'
    ]
  })
  .then(function(bundle) {
    fs.stat('dist', function(error) {
      if (error) {
        fs.mkdirSync('dist');
      }

      var src = 'dist/rollup-plugin-css.js';

      bundle
        .write({
          file: src,
          format: 'cjs'
        })
        .then(function() {
          console.log(`  Build ${src} success!`);
        });
    });
  })
  .catch(function(error) {
    console.error(error);
  });
