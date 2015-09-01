$(document).ready(function() {
    //Launch Welcome Modal
    $('#welcomeModal').modal('show');
    
	//Full-screen modals	
    $('#outputModal').on('shown.bs.modal', function () {
        $(this).find('.modal-dialog').css({width:'auto',
                                   height:'auto', 
                                  'max-height':'100%'});

		//Dygraphs window resize. Workaround for blank graphs at load time. This is for the initial load.
		for(var i=0;i<Simulation.g.length;i++){
			Simulation.g[i].resize();
		}
	});

	//Resizing dygraphs graphs when output tab is clicked. This allows graphs to be seen when switching tabs.
	$('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
		//Dygraphs window resize. Workaround for blank graphs at load time. This is for resizing when changing tabs. 
		for(var i=0;i<Simulation.g.length;i++){
			Simulation.g[i].resize();
		}
	});

    //Populate Saved Sims dropdown if user is logged in
    if ($("#username").html() != undefined) {
        Simulation.getQueries();
		
		//Open the Save Sim input field containing simName input and submit/cancel buttons
		$('#saveSimBtn').click(function(e) {
			$('#saveSimPopup').modal('show');
		});
		
		//When Saved Sim is submitted, save to DB
		$('#confirmSaveSim').click(function(e) {
			e.stopImmediatePropagation();
			Simulation.saveSim($("#username").html());
		});  

		//Close Save Sim success popup
		$('#closeSaveSuccess').click(function(e) {
			$('#saveSimSuccess').hide();
		});
    }

    $("#signInBtn").click(function() {
        window.location.href = "../phpBB3/login.php";
    });
});

var Simulation = {
    sim: [],
    tabs: 0,
	g: [], //dygraph object
    getQueries: function() {
		var username = $("#username").html();
        $.ajax({
            url: "getData.php",
            type: "POST",
            dataType: 'JSON',
            data: {
                param: "getNames",
                username: username,
            },
        }).success(function(data){
			var html = "";
            for (var i = 0; i < data.qid.length; i++) {
                html += "<li><a href='#' id='" + data.qid[i] + "' class='savedSim'>" + data.simName[i] + "</a></li>"
            }
            $("#savedSimsDropdown").html(html);
            $('.dropdown-menu a').click(function() {
                var id = $(this).attr('id');
                Simulation.getSavedSim(id);
            });	
		});
    },
    getSavedSim: function(qid) {
        $.ajax({
            url: "getData.php",
            type: "POST",
            dataType: "JSON",
            data: {
                param: "getSavedSim",
                qid: qid,
            }
        }).success(function(data) {
            Simulation.loadSavedSim(data.data);  
			var html = "<p>Successfully loaded '" + data.simName + "'</p>";
			$("#loadedSimHeaderText").html(html);
			$("#loadedSimHeader").show();
        });
    },
    loadSavedSim: function(data){
        //Load in angular scope from outside the controller
        var scope = angular.element($("#input")).scope();
        scope.$apply(function() {
            scope.data = JSON.parse(data); 
            //Refresh form to show proper data options after loading
            scope.refreshDataForm();
            scope.refreshSpendingForm();
            scope.clearFields('#percentageOfPortfolioLimits');
            scope.refreshInvestigateForm();
        });
    },
    saveSim: function(username){
        var scope = angular.element($("#input")).scope();
        scope.$apply(function() {
            var json_savedSim = JSON.stringify(scope.data, null, 2);
            $.ajax({
                url: "getData.php",
                type: "POST",
                dataType: 'JSON',
                data: {
                    param: "saveSim",
                    json: json_savedSim,
                    username: username,
                    simName: $('#simNameInput').val(),
                },
            }).success(function(){
                $('#saveSimPopup').modal('hide');
                console.log("Save Success!");
                $('#saveSimSuccess').fadeIn( 300, "linear" );
				Simulation.getQueries();
            });
        });
    },
    runSimulation: function(form) {
        this.tabs++;
        console.log("Form Data:", form);
        this.sim = []; //Deletes previous simulation values if they exist.
        var startYear = new Date().getFullYear();
        var endYear = form.retirementEndYear;
        var cycleLength = endYear - startYear + 1;
        var numCycles = 0;
        var cycleStart = 1871;

        //Set number of cycles and cycleStart Year depending on Data options
        if (form.data.method == "historicalAll" || form.data.method == "constant") {
            numCycles = Object.keys(Market).length - cycleLength + 1;
        } else if (form.data.method == "historicalSpecific") {
            numCycles = (form.data.end - form.data.start) - cycleLength + 2;
            cycleStart = parseInt(form.data.start);
        }
        if (form.data.method == "singleCycle") {
            numCycles = 1;
            cycleStart = parseInt(form.data.singleStart);
        }
        if (form.data.method == "singleCycle") {
			console.log("Cycle Start:", cycleStart);
            var cyc = this.cycle(cycleStart, cycleStart + cycleLength);
            this.sim.push(cyc);
        } else if(form.data.method != "historicalSpecific"){
            for (cycleStart; cycleStart < 1871 + numCycles; cycleStart++) {
                var cyc = this.cycle(cycleStart, cycleStart + cycleLength);
                this.sim.push(cyc);
            }
        }else if(form.data.method == "historicalSpecific"){
			for(var i=cycleStart; i < (cycleStart+numCycles); i++){
				var cyc = this.cycle(i, i+cycleLength);
				this.sim.push(cyc);
			}
		}

        for (var i = 0; i < this.sim.length; i++) {
            for (var j = 0; j < this.sim[i].length; j++) {
                this.calcStartPortfolio(form, i, j); //Return Starting portfolio value to kick off yearly simulation cycles
                this.calcSumOfAdjustments(form, i, j);
                this.calcSpending(form, i, j); //Nominal spending for this specific cycle
                this.calcMarketGains(form, i, j); //Calculate market gains on portfolio based on allocation from form and data points
                this.calcEndPortfolio(form, i, j); //Sum up ending portfolio
            }
        }

        //Run post-simulation functions
        this.convertToCSV(this.sim);
        this.calcFailures(this.sim);
        this.displayGraph(this.sim, form);

        //Initialize statistics calculations
        StatsModule.init(this.sim, form);
    },
    cycle: function(startOfRange, endOfRange) {
        //The starting CPI value of this cycle, for comparison throughout the cycle.
        var startCPI = Market[startOfRange.toString()].cpi;
        var cyc = [];
        for (var year = startOfRange; year < endOfRange; year++) {
            data = Market[year.toString()];
            cyc.push({
                "year": year,
                "data": data,
                "portfolio": {
                    "start": null,
                    "end": null,
                    "infAdjStart": null,
                    "infAdjEnd": null,
                    "fees": null
                },
                "spending": null,
                "infAdjSpending": null,
                "equities": {
                    "start": null,
                    "growth": null,
                    "val": null
                },
                "bonds": {
                    "start": null,
                    "growth": null,
                    "val": null
                },
                "gold": {
                    "start": null,
                    "growth": null,
                    "val": null
                },
                "cash": {
                    "start": null,
                    "growth": null,
                    "val": null
                },
                "dividends": {
                    "growth": null,
                    "val": null
                },
                "cumulativeInflation": this.cumulativeInflation(startCPI, data.cpi),
                "socialSecurityAndPensionAdjustments": null,
                "sumOfAdjustments": null,
            });
        }

        return cyc;

    },
    roundTwoDecimals: function(num) {
        return Math.ceil(num * 100) / 100;
    },
    cumulativeInflation: function(startCPI, endCPI) {
        return 1 + ((endCPI - startCPI) / startCPI);
    },
    calcStartPortfolio: function(form, i, j) {
        if (j > 0) {
            this.sim[i][j].portfolio.start = this.roundTwoDecimals(this.sim[i][(j - 1)].portfolio.end);
        } else {
            this.sim[i][j].portfolio.start = this.roundTwoDecimals(form.portfolio.initial);
        }
        this.sim[i][j].portfolio.infAdjStart = this.roundTwoDecimals(this.sim[i][j].portfolio.start / this.sim[i][j].cumulativeInflation);
    },
    calcSpending: function(form, i, j) {
        var spending;
        var currentYear = new Date().getFullYear();
        if (j >= (form.retirementStartYear - currentYear)) {
            spending = SpendingModule[form.spending.method].calcSpending(form, this.sim, i, j);
        } else {
            spending = 0;
        }

        this.sim[i][j].spending = spending; //assign value to main sim container
        this.sim[i][j].infAdjSpending = Math.round(spending / this.sim[i][j].cumulativeInflation);
    },
    calcMarketGains: function(form, i, j) {
        var portfolio = this.sim[i][j].portfolio.start;
        var sumOfAdjustments = this.sim[i][j].sumOfAdjustments; //Sum of all portfolio adjustments for this given year. SS/Pensions/Extra Income/Extra Spending.
        portfolio = portfolio - this.sim[i][j].spending + sumOfAdjustments; //Take out spending and portfolio adjustments before calculating asset allocation. This simulates taking your spending out at the beginning of a year.
		this.sim[i][j].portfolio.start = portfolio;
        //Calculate value of each asset class based on allocation percentages
        var equities = (form.portfolio.percentEquities / 100 * portfolio);
        var bonds = (form.portfolio.percentBonds / 100 * portfolio);
        var gold = (form.portfolio.percentGold / 100 * portfolio);
        var cash = (form.portfolio.percentCash / 100 * portfolio);
        this.sim[i][j].equities.start = equities;
        this.sim[i][j].bonds.start = bonds;
        this.sim[i][j].gold.start = gold;
        this.sim[i][j].cash.start = cash;

        //Calculate growth
        if (form.data.method == "constant") {
            this.sim[i][j].equities.growth = this.roundTwoDecimals(equities * (parseInt(form.data.growth) / 100));
            this.sim[i][j].dividends.growth = 0;
            this.sim[i][j].bonds.growth = this.roundTwoDecimals(bonds * (parseInt(form.data.growth) / 100));
            this.sim[i][j].gold.growth = this.roundTwoDecimals(gold * (parseInt(form.data.growth) / 100));
            this.sim[i][j].cash.growth = this.roundTwoDecimals(cash * ((form.portfolio.growthOfCash / 100)));
        } else {
            this.sim[i][j].equities.growth = this.roundTwoDecimals(equities * (this.sim[i][j].data.growth));
            this.sim[i][j].dividends.growth = this.roundTwoDecimals(equities * this.sim[i][j].data.dividends);

            //New Bond Calculation to incorporate capital appreciation. 
            if (typeof(Market[this.sim[i][j].year + 1]) == "undefined") {
                this.sim[i][j].bonds.growth = this.roundTwoDecimals(bonds * (this.sim[i][j].data.fixed_income));
            } else {
                var bondsGrowth1 = (this.sim[i][j].data.fixed_income) * (1 - (Math.pow((1 + Market[this.sim[i][j].year + 1].fixed_income), (-9)))) / Market[this.sim[i][j].year + 1].fixed_income;
                var bondsGrowth2 = (1 / (Math.pow((1 + Market[this.sim[i][j].year + 1].fixed_income), 9))) - 1;
                this.sim[i][j].bonds.growth = this.roundTwoDecimals(bonds * (bondsGrowth1 + bondsGrowth2 + this.sim[i][j].data.fixed_income));
            }

            this.sim[i][j].gold.growth = this.roundTwoDecimals(gold * (this.sim[i][j].data.gold));
            this.sim[i][j].cash.growth = this.roundTwoDecimals(cash * ((form.portfolio.growthOfCash / 100)));
        }

        //Calculate total value
        this.sim[i][j].equities.end = this.roundTwoDecimals(equities + this.sim[i][j].equities.growth + this.sim[i][j].dividends.growth);
        this.sim[i][j].dividends.val = this.sim[i][j].dividends.growth;
        this.sim[i][j].bonds.end = this.roundTwoDecimals(bonds + this.sim[i][j].bonds.growth);
        this.sim[i][j].gold.end = this.roundTwoDecimals(gold + this.sim[i][j].gold.growth);
        this.sim[i][j].cash.end = this.roundTwoDecimals(cash + this.sim[i][j].cash.growth);
    },
    calcEndPortfolio: function(form, i, j) {
        if (form.portfolio.rebalanceAnnually == true) {
            var feesIncurred = this.roundTwoDecimals((this.sim[i][j].portfolio.start - this.sim[i][j].spending + this.sim[i][j].equities.growth + this.sim[i][j].bonds.growth + this.sim[i][j].cash.growth + this.sim[i][j].gold.growth) * (form.portfolio.percentFees / 100));
            this.sim[i][j].portfolio.fees = feesIncurred;

            //Calculate current allocation percentages after all market gains are taken into consideration
            var curPercEquities = this.sim[i][j].equities.end / (this.sim[i][j].equities.end + this.sim[i][j].bonds.end + this.sim[i][j].cash.end + this.sim[i][j].gold.end);
            var currPercCash = this.sim[i][j].cash.end / (this.sim[i][j].equities.end + this.sim[i][j].bonds.end + this.sim[i][j].cash.end + this.sim[i][j].gold.end);
            var currPercBonds = this.sim[i][j].bonds.end / (this.sim[i][j].equities.end + this.sim[i][j].bonds.end + this.sim[i][j].cash.end + this.sim[i][j].gold.end);
            var currPercGold = this.sim[i][j].gold.end / (this.sim[i][j].equities.end + this.sim[i][j].bonds.end + this.sim[i][j].cash.end + this.sim[i][j].gold.end);

            //Equally distribute fees and portoflio adjustments amongst portfolio based on allocation percentages
            this.sim[i][j].equities.end = this.roundTwoDecimals(this.sim[i][j].equities.end - (curPercEquities * feesIncurred));
            this.sim[i][j].cash.end = this.roundTwoDecimals(this.sim[i][j].cash.end - (currPercCash * feesIncurred));
            this.sim[i][j].bonds.end = this.roundTwoDecimals(this.sim[i][j].bonds.end - (currPercBonds * feesIncurred));
            this.sim[i][j].gold.end = this.roundTwoDecimals(this.sim[i][j].gold.end - (currPercGold * feesIncurred));

            //Sum all assets to determine portfolio end value.
            this.sim[i][j].portfolio.end = this.roundTwoDecimals(this.sim[i][j].equities.end + this.sim[i][j].bonds.end + this.sim[i][j].cash.end + this.sim[i][j].gold.end);
            this.sim[i][j].portfolio.infAdjEnd = parseInt(this.sim[i][j].portfolio.end / this.sim[i][j].cumulativeInflation);

        } else { //Add logic for non-rebalancing portfolios

        }
    },
    calcFailures: function(results) {
        var totalFailures = 0;
        for (var i = 0; i < results.length; i++) {
            var cycleFailure = false;
            for (var j = 0; j < results[i].length; j++) {
                if (results[i][j].portfolio.end < 0) {
                    cycleFailure = true;
                }
            }
            if (cycleFailure == true) {
                totalFailures++;
            }
        }
    },
    calcSumOfAdjustments: function(form, i, j) { //Calculate the sum of all portfolio adjustments for a given year (pensions, extra income, extra spending, etc)
        var currentYear = new Date().getFullYear();
        var socialSecurityAndPensionAdjustments = 0;
        var sumOfAdjustments = 0;
        //Evaluate ExtraIncome given cycle i, year j
        //Social Security - always adjusted by CPI
        if ((j >= (form.extraIncome.socialSecurity.startYear - currentYear)) && (j <= (form.extraIncome.socialSecurity.endYear - currentYear))) {
            socialSecurityAndPensionAdjustments += (form.extraIncome.socialSecurity.val * this.sim[i][j].cumulativeInflation);
        }
        if ((j >= (form.extraIncome.socialSecuritySpouse.startYear - currentYear)) && (j <= (form.extraIncome.socialSecuritySpouse.endYear - currentYear))) {
            socialSecurityAndPensionAdjustments += (form.extraIncome.socialSecuritySpouse.val * this.sim[i][j].cumulativeInflation);
        }

        //Pensions
        for (var k = 0; k < form.extraIncome.pensions.length; k++) {
            if ((j >= (form.extraIncome.pensions[k].startYear - currentYear))) {
                socialSecurityAndPensionAdjustments += this.calcAdjustmentVal(form.extraIncome.pensions[k], i, j);
            }
        }

        sumOfAdjustments += socialSecurityAndPensionAdjustments;
        //Extra Savings
        for (var k = 0; k < form.extraIncome.extraSavings.length; k++) {
            if (form.extraIncome.extraSavings[k].recurring == true) {
                if ((j >= (form.extraIncome.extraSavings[k].startYear - currentYear)) && (j <= (form.extraIncome.extraSavings[k].endYear - currentYear))) {
                    sumOfAdjustments += this.calcAdjustmentVal(form.extraIncome.extraSavings[k], i, j);
                }
            } else if (form.extraIncome.extraSavings[k].recurring == false) {
                if (j == (form.extraIncome.extraSavings[k].startYear - currentYear)) {
                    sumOfAdjustments += this.calcAdjustmentVal(form.extraIncome.extraSavings[k], i, j);
                }
            }
        }

        //Evaluate ExtraSpending
        for (var k = 0; k < form.extraSpending.length; k++) {
            if (form.extraSpending[k].recurring == true) {
                if ((j >= (form.extraSpending[k].startYear - currentYear)) && (j <= (form.extraSpending[k].endYear - currentYear))) {
                    sumOfAdjustments -= this.calcAdjustmentVal(form.extraSpending[k], i, j);
                }
            } else if (form.extraSpending[k].recurring == false) {
                if (j == (form.extraSpending[k].startYear - currentYear)) {
                    sumOfAdjustments -= this.calcAdjustmentVal(form.extraSpending[k], i, j);
                }
            }
        }

        //Add sumOfAdjustments to sim container and return value.
        this.sim[i][j].socialSecurityAndPensionAdjustments = socialSecurityAndPensionAdjustments;
        this.sim[i][j].sumOfAdjustments = sumOfAdjustments;
        return sumOfAdjustments;
    },
    calcAdjustmentVal: function(adj, i, j) {
        //Take in parameter of a portfolio adjustment object, return correct inflation-adjusted amount based on object parameters
        if (adj.inflationAdjusted == true) {
            if (adj.inflationType == "CPI") {
                return (adj.val * this.sim[i][j].cumulativeInflation);
            } else if (adj.inflationType == "constant") {
                var percentage = 1 + (adj.inflationRate / 100);
                return (adj.val * Math.pow(percentage, (j + 1)));
            }
        } else if (adj.inflationAdjusted == false) {
            return adj.val;
        }
    },
    displayGraph: function(results, form) {
        var chartData = [];
        var spendingData = [];
        var interval = results.length;
        var cycLength = results[0].length;
        var simLength = results.length + cycLength - 1;

        //Logic to create array for Dygraphs display. Each series must have an entry for every year in the dataset. If there is no entry for that year in the "results" array, a null value is given so that dygraphs doesn't plot there. This provides the unique look of cFIREsims graph
        for (var i = 0; i < simLength; i++) {
            chartData.push([]);
            spendingData.push([]);
            for (var j = 0; j < interval; j++) {
                chartData[i].push(null);
                spendingData[i].push(null);
            }
        }
        for(var i=0; i < simLength; i++){
            for(var j=0; j < results.length; j++){
                for(var k =0; k < cycLength; k++){
                    if (results[j][k].year == (i + results[0][0].year)) {
                        chartData[i][j] = parseInt(results[j][k].portfolio.infAdjEnd);
                        spendingData[i][j] = results[j][k].infAdjSpending;
                    }
                }
            }
        }

        for (var i = 0; i < simLength; i++) { // Add year to the front of each series array. This is a Dygraphs format standard
            chartData[i].unshift((i + results[0][0].year));
        }
        for (var i = 0; i < simLength; i++) { // Add year to the front of each series array. This is a Dygraphs format standard
            spendingData[i].unshift((i + results[0][0].year));
        }

        //Chart Formatting - Dygraphs
        var labels = ['x'];
        for (var i = 0; i < results.length; i++) {
            var labelyear = i + results[0][0].year;
            var label = '';
            label = 'Cycle Start Year: ' + labelyear;
            labels[i + 1] = label;
        }

		//Chart Series Colors Formatter
        function rainbowColors(length, maxLength)
        {
            var i = (length * 255 / maxLength);
            var r = Math.round(Math.sin(0.024 * i + 0) * 127 + 128);
            var g = Math.round(Math.sin(0.024 * i + 2) * 127 + 128);
            var b = Math.round(Math.sin(0.024 * i + 4) * 127 + 128);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        var colors = [];
        for (var i=0; i<results.length; i++){
            colors.push(rainbowColors(i,results.length));
        }

        //Portfolio Graph
        Simulation.g.push(new Dygraph(
            // containing div
            document.getElementById("graph" + Simulation.tabs),
            chartData, {
                labels: labels.slice(),
                legend: 'always',
                title: 'cFIREsim Simulation Cycles',
                ylabel: 'Portfolio ($)',
                xlabel: 'Year',
                labelsDivStyles: {
                    'textAlign': 'right'
                },
                labelsDivWidth: 500,
                labelsDiv: 'labels' + Simulation.tabs,
                digitsAfterDecimal: 0,
                axes: {
                    y: {
                        axisLabelWidth: 100,
                        labelsKMB: false,
                        maxNumberWidth: 11,
                        valueFormatter: function numberWithCommas(x) {
                            return 'Portfolio: $' + x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        },
                        axisLabelFormatter: function numberWithCommas(x) {
                            return '$' + x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        }
                    },
                    x: {
                        valueFormatter: function numberWithCommas(x) {
                            return 'Year: ' + x;
                        },
                    },
                },
                colors: colors,
                showLabelsOnHighlight: true,
                highlightCircleSize: 3,
                strokeWidth: 1.5,
                strokeBorderWidth: 0,
                highlightSeriesBackgroundAlpha: 1.0,
                highlightSeriesOpts: {
                    strokeWidth: 4,
                    strokeBorderWidth: 2,
                    highlightCircleSize: 7,
                },
            }
        ));



        //Spending Graph
        Simulation.g.push(new Dygraph(
            // containing div
            document.getElementById("graph" + Simulation.tabs + "b"),
            spendingData, {
                labels: labels.slice(),
                legend: 'always',
                title: 'Spending Level',
                ylabel: 'Spending ($)',
                xlabel: 'Year',
                labelsDivStyles: {
                    'textAlign': 'right'
                },
                labelsDiv: 'labels' + Simulation.tabs + "b",
                labelsDivWidth: 500,
                digitsAfterDecimal: 0,
                axes: {
                    y: {
                        axisLabelWidth: 100,
                        labelsKMB: false,
                        maxNumberWidth: 11,
                        valueFormatter: function numberWithCommas(x) {
                            return 'Spending: $' + x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        },
                        axisLabelFormatter: function numberWithCommas(x) {
                            return '$' + x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        }
                    },
                    x: {
                        valueFormatter: function numberWithCommas(x) {
                            return 'Year: ' + x;
                        },
                    },
                },
                colors: colors,
                showLabelsOnHighlight: true,
                highlightCircleSize: 3,
                strokeWidth: 1.5,
                strokeBorderWidth: 0,
                highlightSeriesBackgroundAlpha: 1.0,
                highlightSeriesOpts: {
                    strokeWidth: 4,
                    strokeBorderWidth: 2,
                    highlightCircleSize: 5,
                },
            }
        ));

        $('#tabNav a[href="#' + Simulation.tabs + 'a"]').tab('show');
        $('a[href="#'+ Simulation.tabs+'a"]').parent('li').show();
    },
    convertToCSV: function(results) { //converts a random cycle of simulation into a CSV file, for users to easily view
        var csv = "";
        /*
        //Random number generator for supplying a CSV of only 1 random cycle. Disabled for debugging purposes.
        function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min)) + min;
        }
        var num = getRandomInt(0, results.length);
        */

        for (var j = 0; j < results.length; j++) {
            csv = csv.concat("Year,CumulativeInflation,portfolio.start,portfolio.infAdjStart,spending,infAdjSpending,PortfolioAdjustments,Equities,Bonds,Gold,Cash,equities.growth,dividends,bonds.growth,gold.growth,cash.growth,fees,portfolio.end,portfolio.infAdjEnd\r\n");
            for (var i = 0; i < results[j].length; i++) {
                csv = csv.concat(results[j][i].year + ",");
                csv = csv.concat(results[j][i].cumulativeInflation + ",");
                csv = csv.concat(results[j][i].portfolio.start + ",");
                csv = csv.concat(results[j][i].portfolio.infAdjStart + ",");
                csv = csv.concat(results[j][i].spending + ",");
                csv = csv.concat(results[j][i].infAdjSpending + ",");
                csv = csv.concat(results[j][i].sumOfAdjustments + ",");
                csv = csv.concat(results[j][i].equities.start + ",");
                csv = csv.concat(results[j][i].bonds.start + ",");
                csv = csv.concat(results[j][i].gold.start + ",");
                csv = csv.concat(results[j][i].cash.start + ",");
                csv = csv.concat(results[j][i].equities.growth + ",");
                csv = csv.concat(results[j][i].dividends.growth + ",");
                csv = csv.concat(results[j][i].bonds.growth + ",");
                csv = csv.concat(results[j][i].gold.growth + ",");
                csv = csv.concat(results[j][i].cash.growth + ",");
                csv = csv.concat(results[j][i].portfolio.fees + ",");
                csv = csv.concat(results[j][i].portfolio.end + ",");
                csv = csv.concat(results[j][i].portfolio.infAdjEnd + ",");
                csv = csv.concat("\r\n");
            }
            csv = csv.concat("Year,CumulativeInflation,portfolio.start,portfolio.infAdjStart,spending,infAdjSpending,PortfolioAdjustments,Equities,Bonds,Gold,Cash,equities.growth,dividends,bonds.growth,gold.growth,cash.growth,fees,portfolio.end,portfolio.infAdjEnd\r\n\r\n");

        }

        var uri = 'data:text/csv;charset=utf-8,' + escape(csv);
        // Now the little tricky part.
        // you can use either>> window.open(uri);
        // but this will not work in some browsers
        // or you will not get the correct file extension    

        // See if the link already exists and if it does, delete it.
        var oldLink = document.getElementById("csvDownloadLink");
        if (oldLink !== null) {
            oldLink.parentNode.removeChild(oldLink);
        }
        //this trick will generate a temp <a /> tag
        var link = document.createElement("a");
        var linkText = document.createTextNode("Download Year-by-year Spreadsheet");
        link.title = "Download Year-by-year Spreadsheet";
        // Add an id to the link to be able to remove it
        link.id = "csvDownloadLink";
        link.appendChild(linkText);
        link.href = uri;

        //set the visibility hidden so it will not effect on your web-layout
        //link.style = "visibility:hidden";
        link.download = "cfiresim.csv";

        //this part will append the anchor tag and remove it after automatic click
        document.body.appendChild(link);
        $(link).appendTo("#download"+Simulation.tabs);
		$(link).addClass("btn btn-success btn-lg");
        //link.click();
        //document.body.removeChild(link);
    }
};

