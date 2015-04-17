import { resolve } from 'path';
import { cyan } from 'chalk';
import { Merger, Source } from '../nodes';
import config from '../config';
import { isString } from './is';
import argsAndOpts from './argsAndOpts';

let sources = {};

export default getNode;

function getNode ( parts ) {
	let [ inputs, options ] = argsAndOpts( parts, true );

	if ( inputs.length === 1 ) {
		if ( inputs[0]._gobble ) {
			return inputs[0];
		} else if ( isString( inputs[0] ) ) {
			let input = resolve( config.cwd, inputs[0] );
			return sources[ input ] || ( sources[ inputs ] = new Source( input, options ) );
		} else {
			throw new Error( `could not process input. Usage:
	node2 = gobble(node1)
	node = gobble('some/dir')
	node = gobble('some/dir', node1, 'other/dir', node2, { options })
	node = gobble([node1, node2[, nodeN]) (inputs can also be strings)
	See ${cyan( 'https://github.com/gobblejs/gobble/wiki' )} for more info.` );
		}
	}

	inputs = inputs.map( n => getNode( n ) );
	return new Merger( inputs, options );
}
