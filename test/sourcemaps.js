var assert = require( 'assert' );
var path = require( 'path' );
var request = require( 'request-promise' );
var gobble = require( '../tmp' ).default;
var sander = require( 'sander' );
var SourceMapConsumer = require( 'source-map' ).SourceMapConsumer;
var simulateChange = require( './utils/simulateChange' );

var Promise = sander.Promise;

gobble.cwd( __dirname );

function identity ( input ) {
	return input;
}

module.exports = function () {
	var task;

	describe( 'sourcemaps', function () {
		beforeEach( function () {
			return sander.rimraf( 'tmp' ).then( function () {
				return sander.copydir( 'sample' ).to( 'tmp' );
			});
		});

		afterEach( function () {
			try {
				return task.close().then( cleanup );
			} catch ( err ) {
				if ( task ) {
					throw err;
				}
			} finally {
				task = null;
				return cleanup();
			}

			function cleanup () {
				return sander.rimraf( 'tmp' );
			}
		});

		it( 'should deconflict automatically generated sourcemaps (#38)', function ( done ) {
			task = gobble( 'tmp/baz' ).transform( copy ).transform( copy ).serve();

			function copy ( input ) {
				return {
					code: input,
					map: {
						mappings: ''
					}
				};
			}

			task.on( 'error', done );
			task.on( 'built', function () {
				request( 'http://localhost:4567/foo.js' )
					.then( function ( body ) {
						var expectedStart = "console.log( 'foo.js' )";
						assert.equal( body.substr( 0, expectedStart.length ), expectedStart );
						done();
					})
					.catch( done );
			});
		});

		it( 'populates auto-generated sourcemaps with the correct sourcesContent', function ( done ) {
			task = gobble( 'tmp/baz' ).transform( copy ).serve();

			function copy ( input ) {
				return {
					code: input.toUpperCase(),
					map: {
						mappings: 'AACA',
						names: []
					}
				};
			}

			task.on( 'error', done );
			task.on( 'built', function () {
				request( 'http://localhost:4567/foo.js' ).then( function ( body ) {
					var sourceMappingURL = /sourceMappingURL=(.+)/.exec( body )[1];
					assert.equal( sourceMappingURL, 'foo.js.map' );
					request( 'http://localhost:4567/foo.js.map' ).then( JSON.parse ).then( function ( map ) {
						assert.deepEqual( map.sourcesContent, [ sander.readFileSync( 'tmp/baz/foo.js' ).toString() ] );
						done();
					}).catch( done );
				});
			});
		});

		it( 'fixes inline sourcemaps (#45)', function () {
			var source = gobble( 'tmp/baz' );

			return source.transform( function ( input ) {
				return input + '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + btoa( JSON.stringify({ mappings: 'AAAA', names: [] }) );
			}).build({
				dest: 'tmp/output'
			}).then( function () {
				return Promise.all([
					sander.readFile( 'tmp/output/foo.js' )
						.then( String )
						.then( function ( body ) {
							var sourceMappingURL = /sourceMappingURL=(.+)/.exec( body )[1];
							assert.equal( sourceMappingURL, 'foo.js.map' );
						}),

					sander.readFile( 'tmp/output/foo.js.map' )
						.then( String )
						.then( JSON.parse )
						.then( function ( map ) {
							assert.ok( /foo\.js$/.test( map.file ) );
							assert.deepEqual( map.sources, ['../baz/foo.js' ] );
							assert.deepEqual( map.sourcesContent, [ sander.readFileSync( 'tmp/baz/foo.js' ).toString() ] );
						})
				]);
			});
		});

		it( 'allows file transformer result to be an object with `code` but no `map`', function () {
			var source = gobble( 'tmp/foo' );

			return source.transform( function ( input ) {
				return { code: input };
			}).build({
				dest: 'tmp/output'
			}).then( function () {
				return sander.readFile( 'tmp/output/foo.md' )
					.then( String )
					.then( function ( body ) {
						assert.equal( body, [ sander.readFileSync( 'tmp/foo/foo.md' ).toString() ] );
					});
			});
		});

		it( 'should not make a file transform without a sourcemap sprout an invalid one', function ( done ) {
			sander.writeFileSync( 'tmp/dynamic/baz', 'step1' );
			var source = gobble( 'tmp/dynamic' );

			function toTxt ( input ) {
				return input;
			}

			task = source.transform( toTxt ).watch({ dest: 'tmp/output' });

			task.once( 'built', function () {
				task.once( 'built', function () {
					var content = sander.readFileSync( 'tmp/output/baz' );
					assert.equal( content, 'step2' );
					done();
				});

				sander.writeFileSync( 'tmp/dynamic/baz', 'step2' );

				simulateChange( source, {
					type: 'change',
					path: 'tmp/dynamic/baz'
				});
			});

			task.on( 'error', function ( err ) {
				setTimeout( function () {
					throw err;
				});
			});
		});

		it( 'does not use non-existent sourcemap files when reusing cached file transformer results', function ( done ) {
			var source = gobble( 'tmp/foo' );

			task = source.transform( identity ).transform( function ( input ) {
				return input + Math.random();
			}).serve();

			task.on( 'error', done );

			task.once( 'built', function () {
				simulateChange( source, {
					type: 'change',
					path: 'tmp/foo/foo.md'
				});

				task.once( 'built', function () {
					done();
				});
			});
		});

		it( 'encodes sourceMappingURLs (#47)', function () {
			var source = gobble( 'tmp/spaces' );

			return source.transform( function ( input ) {
				return {
					code: input,
					map: {
						mappings: 'AACA',
						names: []
					}
				};
			}).build({
				dest: 'tmp/output'
			}).then( function () {
				return sander.readFile( 'tmp/output/file with spaces.js' )
					.then( String )
					.then( function ( contents ) {
						var sourceMappingURL = /sourceMappingURL=([^\r\n]+)/.exec( contents )[1];
						assert.ok( !/\s/.test( sourceMappingURL ) );
					});
			});
		});

		it( 'flattens sourcemap chains when serving (#22)', function ( done ) {
			var source = gobble( 'tmp/sourcemaps' );

			task = source
				.transform( 'coffee' )
				.transform( 'uglifyjs', { ext: '.min.js' })
				.serve();

			task.once( 'ready', function () {
				Promise.all([
					request( 'http://localhost:4567/app.min.js' )
						.then( function ( body ) {
							var sourceMappingURL = /sourceMappingURL=([^\r\n]+)/.exec( body )[1];
							assert.equal( sourceMappingURL, 'app.min.js.map' );
						}),

					request( 'http://localhost:4567/app.min.js.map' )
						.then( String )
							.then( JSON.parse )
							.then( function ( map ) {
								var smc = new SourceMapConsumer( map );
								var loc = smc.originalPositionFor({ line: 1, column: 31 });

								assert.strictEqual( loc.line, 2 );
								assert.strictEqual( loc.column, 8 );
								assert.strictEqual( loc.source.slice( -10 ), 'app.coffee' );
							})
				]).then( function () {
					done();
				}, done );
			});
		});

		it( 'flattens sourcemap chains when building (#22)', function () {
			var source = gobble( 'tmp/sourcemaps' );

			return source
				.transform( 'coffee' )
				.transform( 'uglifyjs', { ext: '.min.js' })
				.build({
					dest: 'tmp/output'
				})
				.then( function () {
					return Promise.all([
						sander.readFile( 'tmp/output/app.min.js' )
							.then( String )
							.then( function ( content ) {
								var sourceMappingURL = /sourceMappingURL=([^\r\n]+)/.exec( content )[1];
								assert.equal( sourceMappingURL, 'app.min.js.map' );
							}),

						sander.readFile( 'tmp/output/app.min.js.map' )
							.then( String )
							.then( JSON.parse )
							.then( function ( map ) {
								var smc = new SourceMapConsumer( map );
								var loc = smc.originalPositionFor({ line: 1, column: 31 });

								assert.strictEqual( loc.line, 2 );
								assert.strictEqual( loc.column, 8 );
								assert.strictEqual( loc.source.slice( -10 ), 'app.coffee' ); // TODO get head round source paths
							}),

						sander.lsr( 'tmp/output' )
							.then( function ( files ) {
								assert.deepEqual( files, [ 'app.min.js', 'app.min.js.map' ]);
							})
					]);
				});
		});

		it( 'flattens sourcemap chains across non-sourcemap-generating transform boundaries', function () {
			var source = gobble( 'tmp/baz' );

			return source
				.transform( function ( input ) {
					return {
						code: input,
						map: {
							mappings: 'AACA',
							names: []
						}
					};
				})
				.include( 'foo.js' )
				.build({
					dest: 'tmp/output'
				}).then( function () {
					return sander.readFile( 'tmp/output/foo.js.map' )
						.then( String )
						.then( JSON.parse )
						.then( function ( map ) {
							assert.equal( map.file, 'foo.js' );
							assert.deepEqual( map.sources, [ '../baz/foo.js' ] );
							assert.deepEqual( map.sourcesContent, [ sander.readFileSync( 'tmp/baz/foo.js' ).toString() ] );
						});
				});
		});

		it( 'flattens CSS sourcemaps correctly', function () {
			var source = gobble( 'tmp/css' );

			// fake gobble-sass output
			var css = 'body {\n  color: #c80000; }\n\n/*# sourceMappingURL=main.css.map */';
			var cssMap = {
				"version":3,
				"file":"main.css",
				"sources":[path.resolve("tmp/css/main.scss")],
				"sourcesContent":[
					"$red: rgba(200,0,0,1);\n\nbody {\n\tcolor: $red;\n}"
				],
				"names":[],
				"mappings":"AAEA;EACC,AAHK"
			};

			return source
				.transform( function ( inputdir, outputdir, options, callback ) {
					sander.writeFileSync( outputdir, 'main.css', css );
					sander.writeFileSync( outputdir, 'main.css.map', JSON.stringify( cssMap ) );
					callback();
				})
				.build({
					dest: 'tmp/output'
				})
				.then( function () {
					// ignore differences in newlines
					var actualCss = sander.readFileSync( 'tmp/output/main.css' ).toString().replace( /\n/g, '' );
					var expectedCss = css.replace( /\n/g, '' );
					assert.equal( actualCss, expectedCss );

					var actualMap = sander.readFileSync( 'tmp/output/main.css.map' ).toString().replace( /\n/g, '' );
					actualMap = JSON.parse( actualMap );

					actualMap.sources = actualMap.sources.map( function ( source ) {
						return path.resolve( 'tmp/output', source );
					});

					assert.deepEqual( actualMap, cssMap );
				});
		});
	});
};

function btoa ( str ) {
	return new Buffer( str ).toString( 'base64' );
}