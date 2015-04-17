import { EventEmitter2 } from 'eventemitter2';
import * as crc32 from 'buffer-crc32';
import { lsrSync, readFileSync, rimraf } from 'sander';
import { join, resolve } from 'path';
import * as requireRelative from 'require-relative';
import { grab, include, map as mapTransform, move } from '../builtins';
import { Observer, Transformer } from './index';
import config from '../config';
import GobbleError from '../utils/GobbleError';
import flattenSourcemaps from '../utils/flattenSourcemaps';
import assign from '../utils/assign';
import warnOnce from '../utils/warnOnce';
import compareBuffers from '../utils/compareBuffers';
import serve from './serve';
import build from './build';
import watch from './watch';
import { isRegExp, isString } from '../utils/is';
import argsAndOpts from '../utils/argsAndOpts';
import { ABORTED } from '../utils/signals';

export default class Node extends EventEmitter2 {
	constructor () {
		this._gobble = true; // makes life easier for e.g. gobble-cli

		// initialise event emitter
		super({ wildcard: true });

		this.counter = 1;
		this.inspectTargets = [];
	}

	// This gets overwritten each time this.ready is overwritten. Until
	// the first time that happens, it's a noop
	_abort () {}

	_findCreator () {
		return this;
	}

	build ( options ) {
		return build( this, options );
	}

	createWatchTask ( dest ) {
		const node = this;
		const watchTask = new EventEmitter2({ wildcard: true });

		// TODO is this the best place to handle this stuff? or is it better
		// to pass off the info to e.g. gobble-cli?
		let previousDetails;

		node.on( 'info', details => {
			if ( details === previousDetails ) return;
			previousDetails = details;
			watchTask.emit( 'info', details );
		});

		let buildScheduled;

		node.on( 'invalidate', changes => {
			// A node can depend on the same source twice, which will result in
			// simultaneous rebuilds unless we defer it to the next tick
			if ( !buildScheduled ) {
				buildScheduled = true;
				watchTask.emit( 'info', {
					changes,
					code: 'BUILD_INVALIDATED'
				});

				process.nextTick( build );
			}
		});

		node.on( 'error', handleError );

		function build () {
			const buildStart = Date.now();

			buildScheduled = false;

			node.ready()
				.then( d => flattenSourcemaps( d, dest, node ).catch( err => { watchTask.emit('error', err); return d; }) )
				.then( d => {
					watchTask.emit( 'info', {
						code: 'BUILD_COMPLETE',
						duration: Date.now() - buildStart,
						watch: true
					});

					watchTask.emit( 'built', d );
				})
				.catch( handleError );
		}

		function handleError ( e ) {
			if ( e === ABORTED ) {
				// these happen shortly after an invalidation,
				// we can ignore them
				return;
			} else {
				watchTask.emit( 'error', e );
			}
		}

		watchTask.close = () => node.stop();

		this.start();
		build();

		return watchTask;
	}

	exclude ( ...parts ) {
		let [ patterns, opts ] = argsAndOpts( parts, true );
		opts.patterns = patterns;
		opts.exclude = true;
		return new Transformer( this, include, opts );
	}

	getChanges ( inputdir ) {
		const files = lsrSync( inputdir );

		if ( !this._files ) {
			this._files = files;
			this._checksums = {};

			files.forEach( file => {
				this._checksums[ file ] = crc32( readFileSync( inputdir, file ) );
			});

			return files.map( file => ({ file, added: true }) );
		}

		const added = files.filter( file => !~this._files.indexOf( file ) ).map( file => ({ file, added: true }) );
		const removed = this._files.filter( file => !~files.indexOf( file ) ).map( file => ({ file, removed: true }) );

		const maybeChanged = files.filter( file => ~this._files.indexOf( file ) );

		let changed = [];

		maybeChanged.forEach( file => {
			let checksum = crc32( readFileSync( inputdir, file ) );

			if ( !compareBuffers( checksum, this._checksums[ file ] ) ) {
				changed.push({ file, changed: true });
				this._checksums[ file ] = checksum;
			}
		});

		return added.concat( removed ).concat( changed );
	}

	grab ( ...parts ) {
		let [ path, opts ] = argsAndOpts( parts );
		opts.src = join.apply( null, path );
		return new Transformer( this, grab, opts );
	}

	// Built-in transformers
	include ( ...parts ) {
		let [ patterns, opts ] = argsAndOpts( parts, true );
		opts.patterns = patterns;
		return new Transformer( this, include, opts );
	}

	inspect ( target, options ) {
		target = resolve( config.cwd, target );

		if ( options && options.clean ) {
			rimraf( target );
		}

		this.inspectTargets.push( target );
		return this; // chainable
	}

	map ( fn, userOptions ) {
		warnOnce( 'node.map() is deprecated. You should use node.transform() instead for both file and directory transforms' );
		return this.transform( fn, userOptions );
	}

	moveTo ( ...parts ) {
		let [ path, opts ] = argsAndOpts( parts );
		opts.dest = join.apply( null, path );
		return new Transformer( this, move, opts );
	}

	observe ( fn, userOptions ) {
		if ( isString( fn ) ) {
			fn = tryToLoad( fn );
		}

		return new Observer( this, fn, userOptions );
	}

	observeIf ( condition, fn, userOptions ) {
		return condition ? this.observe( fn, userOptions ) : this;
	}

	serve ( options ) {
		return serve( this, options );
	}

	transform ( fn, userOptions ) {
		if ( typeof fn === 'string' ) {
			// TODO remove this for 0.9.0
			if ( fn === 'sorcery' ) {
				warnOnce( 'Sourcemaps are flattened automatically as of gobble 0.8.0. You should remove the sorcery transformation from your build definition' );
				return this;
			}

			fn = tryToLoad( fn );
		}

		// If function takes fewer than 3 arguments, it's a file transformer
		if ( fn.length < 3 ) {
			const options = assign( {}, fn.defaults, userOptions, {
				fn,
				cache: {},
				userOptions: assign( {}, userOptions )
			});

			if ( typeof options.accept === 'string' || isRegExp( options.accept ) ) {
				options.accept = [ options.accept ];
			}

			return new Transformer( this, mapTransform, options, fn.id || fn.name );
		}

		// Otherwise it's a directory transformer
		return new Transformer( this, fn, userOptions );
	}

	transformIf ( condition, fn, userOptions ) {
		return condition ? this.transform( fn, userOptions ) : this;
	}

	watch ( options ) {
		return watch( this, options );
	}
}

function tryToLoad ( plugin ) {
	try {
		return requireRelative( `gobble-${plugin}`, process.cwd() );
	} catch ( err ) {
		if ( err.message === `Cannot find module 'gobble-${plugin}'` ) {
			throw new GobbleError({
				message: `Could not load gobble-${plugin} plugin`,
				code: 'PLUGIN_NOT_FOUND',
				plugin: plugin
			});
		} else {
			throw err;
		}
	}
}
