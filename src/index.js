import { resolve } from 'path';
import * as sander from 'sander';
import getNode from './utils/getNode';
import config from './config';

var gobble = ( ...parts ) => getNode( parts );

gobble.env = function ( env ) {
	if ( arguments.length ) {
		config.env = env;
	}

	return config.env;
};

gobble.cwd = function () {
	if ( arguments.length ) {
		config.cwd = resolve.apply( null, arguments );
	}

	return config.cwd;
};

gobble.sander = sander;

export default gobble;
