import { isArray, isObject } from './is';

export default function( array, flatten = false ) {
	if ( !isArray( array ) ) { array = [ array ]; }

	if ( array.length === 1 ) {
		if ( flatten ) {
			array = Array.prototype.concat.apply( [], array );
		}
		return [ array, {} ];
	}

	let opts = array.slice( -1 );
	let args = array.slice( 0, -1 );

	if ( !isObject( opts ) ) {
		args.push( opts );
		opts = {};
	}

	if ( flatten ) {
		args = Array.prototype.concat.apply( [], args );
	}

	return [ args, opts ];
}
