var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');

var baseFiles = [
    'src/leaflet.shadowwrap.hook.js',
    'src/leaflet.shadowwrap.exception.js',
    'src/leaflet.shadowwrap.dispatch.js',
    'src/leaflet.shadowwrap.shadows.js',
    'src/leaflet.shadowwrap.calcshadow.js'
];

var drawFiles = [
    'src/leaflet.shadowwrap.draw.js'
];

gulp.task('build', function(cb) {
    gulp.src(baseFiles)
        .pipe(concat('leaflet.shadowwrap.js'))
        .pipe(gulp.dest('dist'))
        .pipe(rename('leaflet.shadowwrap.min.js'))
        .pipe(uglify())
        .pipe(gulp.dest('dist'));
    cb();      
});


gulp.task('build draw', ['build'], function() {
    return gulp.src(drawFiles)
               .pipe(concat('leaflet.shadowwrap.draw.js'))
               .pipe(gulp.dest('dist'))
               .pipe(rename('leaflet.shadowwrap.draw.min.js'))
               .pipe(uglify())
               .pipe(gulp.dest('dist'));
});

gulp.task('default', ['build', 'build draw']);