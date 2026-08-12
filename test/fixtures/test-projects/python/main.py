"""Entry point for the implant test fixture.

Docs: https://example.com/implant/docs
"""
from utils import Adder,greet,DEFAULT_NAME


def entry(  )->None :
    'Run the demo.'
    total: str=Adder( base=10 ).add( 5 )
    print( greet(DEFAULT_NAME),total )


if __name__ == '__main__':
    entry()
