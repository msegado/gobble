import { isArray, isObject, isFunction } from './is';

export default function( array, flatten = false, isOptions = null ) {
	if ( !isArray( array ) ) { array = [ array ]; }

	if ( array.length === 1 ) {
		if ( flatten ) {
			array = Array.prototype.concat.apply( [], array );
		}
		return [ array, {} ];
	}

	let opts = array.slice( -1 )[0];
	let args = array.slice( 0, -1 );

	if ( !isObject( opts ) || ( isFunction( isOptions ) && !isOptions( opts ) ) ) {
		args.push( opts );
		opts = {};
	}

	if ( flatten ) {
		args = Array.prototype.concat.apply( [], args );
	}

	return [ args, opts ];
}
