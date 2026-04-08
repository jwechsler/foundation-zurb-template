import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import gulp from 'gulp';
import gulpIf from 'gulp-if';
import gulpSass from 'gulp-sass';
import postcss from 'gulp-postcss';
import terser from 'gulp-terser';
import imagemin, { gifsicle, mozjpeg, optipng, svgo } from 'gulp-imagemin';
import * as sassCompiler from 'sass-embedded';
import webpackStream from 'webpack-stream';
import webpack2 from 'webpack';
import named from 'vinyl-named';
import autoprefixer from 'autoprefixer';
import browser from 'browser-sync';
import panini from 'panini';
import { rimraf } from 'rimraf';
import sherpa from 'style-sherpa';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// js-yaml and js-yaml-js-types must both be loaded via CJS
// so they share the same Type class instances
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const jsYamlJsTypes = require('js-yaml-js-types');

// Initialize gulp-sass with sass-embedded compiler
const sass = gulpSass(sassCompiler);

// Check for --production flag
const argv = yargs(hideBin(process.argv)).argv;
const PRODUCTION = !!argv.production;

// Load settings from config.yml
function loadConfig() {
  const unsafe = jsYamlJsTypes.all;
  const schema = yaml.DEFAULT_SCHEMA.extend(unsafe);
  const ymlFile = readFileSync('config.yml', 'utf8');
  return yaml.load(ymlFile, { schema });
}
const { PORT, UNCSS_OPTIONS, PATHS } = loadConfig();

// Build the "dist" folder by running all of the below tasks
// Sass must be run later so UnCSS can search for used classes in the other assets.
gulp.task('build',
  gulp.series(clean, gulp.parallel(pages, javascript, images, copy), sassBuild, styleGuide)
);

// Build the site, run the server, and watch for file changes
gulp.task('default',
  gulp.series('build', server, watch)
);

// Delete the "dist" folder
// This happens every time a build starts
async function clean() {
  await rimraf(PATHS.dist + '/*', { glob: true });
}

// Copy files out of the assets folder
// This task skips over the "img", "js", and "scss" folders, which are parsed separately
function copy() {
  return gulp.src(PATHS.assets, { encoding: false })
    .pipe(gulp.dest(PATHS.dist + '/assets'));
}

// Copy page templates into finished HTML files
function pages() {
  return gulp.src('src/pages/**/*.{html,hbs,handlebars}')
    .pipe(panini({
      root: 'src/pages/',
      layouts: 'src/layouts/',
      partials: 'src/partials/',
      data: 'src/data/',
      helpers: 'src/helpers/'
    }))
    .pipe(gulp.dest(PATHS.dist));
}

// Load updated HTML templates and partials into Panini
function resetPages(done) {
  panini.refresh();
  done();
}

// Generate a style guide from the Markdown content and HTML template in styleguide/
function styleGuide(done) {
  sherpa('src/styleguide/index.md', {
    output: PATHS.dist + '/styleguide.html',
    template: 'src/styleguide/template.html'
  }, done);
}

// Compile Sass into CSS
// In production, the CSS is compressed
function sassBuild() {
  const postCssPlugins = [
    autoprefixer(),
    // UnCSS - Uncomment to remove unused styles in production
    // PRODUCTION && uncss(UNCSS_OPTIONS),
  ].filter(Boolean);

  return gulp.src('src/assets/scss/app.scss', { sourcemaps: !PRODUCTION })
    .pipe(sass({
      includePaths: PATHS.sass
    }).on('error', sass.logError))
    .pipe(postcss(postCssPlugins))
    .pipe(gulp.dest(PATHS.dist + '/assets/css', { sourcemaps: '.' }))
    .pipe(browser.reload({ stream: true }));
}

let webpackConfig = {
  mode: (PRODUCTION ? 'production' : 'development'),
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ["@babel/preset-env"],
            compact: false
          }
        }
      }
    ]
  },
  devtool: !PRODUCTION && 'source-map'
};

// Combine JavaScript into one file
// In production, the file is minified
function javascript() {
  return gulp.src(PATHS.entries)
    .pipe(named())
    .pipe(webpackStream(webpackConfig, webpack2))
    .pipe(gulpIf(PRODUCTION, terser()
      .on('error', e => { console.log(e); })
    ))
    .pipe(gulp.dest(PATHS.dist + '/assets/js'));
}

// Copy images to the "dist" folder
// In production, the images are compressed
function images() {
  return gulp.src('src/assets/img/**/*', { encoding: false })
    .pipe(gulpIf(PRODUCTION, imagemin([
      gifsicle({ interlaced: true }),
      mozjpeg({ quality: 85, progressive: true }),
      optipng({ optimizationLevel: 5 }),
      svgo({
        plugins: [
          { name: 'removeViewBox', active: true },
          { name: 'cleanupIDs', active: false }
        ]
      })
    ])))
    .pipe(gulp.dest(PATHS.dist + '/assets/img'));
}

// Start a server with BrowserSync to preview the site in
function server(done) {
  browser.init({
    server: PATHS.dist, port: PORT
  }, done);
}

// Reload the browser with BrowserSync
function reload(done) {
  browser.reload();
  done();
}

// Watch for changes to static assets, pages, Sass, and JavaScript
function watch() {
  gulp.watch(PATHS.assets, copy);
  gulp.watch('src/pages/**/*.html').on('all', gulp.series(pages, browser.reload));
  gulp.watch('src/{layouts,partials}/**/*.html').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/data/**/*.{js,json,yml}').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/helpers/**/*.js').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/assets/scss/**/*.scss').on('all', sassBuild);
  gulp.watch('src/assets/js/**/*.js').on('all', gulp.series(javascript, browser.reload));
  gulp.watch('src/assets/img/**/*').on('all', gulp.series(images, browser.reload));
  gulp.watch('src/styleguide/**').on('all', gulp.series(styleGuide, browser.reload));
}
